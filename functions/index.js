const request = require('request');
const functions = require('firebase-functions');
// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();
// allow CORS
const cors = require('cors')({origin: true});
// StellarSdk is required to connect to the Stellar blockchain network
const StellarSdk = require('stellar-sdk');
StellarSdk.Network.useTestNetwork(); // use the testing network for now. Do not run on production network
// Connect to the Stellar Horizon Server
const server = new StellarSdk.Server('https://horizon-testnet.stellar.org');

/**
 * createStellarAccount
 * 
 * Submits a GET request to create a Stellar account for the provided Keypair
 * 
 * @param {StellarSdk.Keypair} pair 
 */
const createStellarAccount = ( pair, govKeys, amount ) => {
    request.get({
        url: 'https://friendbot.stellar.org',
        qs: { addr: pair.publicKey() },
        json: true
    }, (error, response, body) => {
        if (error || response.statusCode !== 200) {
          console.error('Stellar account Error', error || body);
        }
        else {
          console.log('Stellar account success :)\n', body);
          if ( govKeys && amount ) {
            createTransaction( pair.publicKey(), govKeys, amount );
          }
        }
    });
}

/**
 * createStellarSecret
 * 
 * Generate a crypto wallet for each user as it joins the network
 */
exports.createStellarSecret = functions.database.ref( "/users/{user_id}" )
    .onCreate( (snapshot, context) => {
        const user_id = context.params.user_id;
        const user = snapshot.val();
        // generate the keys that we need
        var pair = StellarSdk.Keypair.random(); // generate the key
        // create a wallet for them in the background
        console.log( `Creating stellar account for ${user_id}` );
        // use the testing goverment wallet
        let govKeys = StellarSdk.Keypair.fromSecret(
            "SAJNXVDDTWYQR3CNN4V74CKHIMRLSGJEIICBM7B57ZK5VMHOKP7C6TBJ"
        );
        // and create the account
        createStellarAccount( pair, user.type == 20 ? govKeys : false, user.benefit );
        // update the database with the encryption secrets
        return admin.database().ref( `/users/${user_id}` )
            .update( { 
                secret: pair.secret(),
                public_key: pair.publicKey(),
                sequence_number: 0,
            });
    });

const invalidRequest = ( response ) => {
    return response.status(400).send(
        { success: false, message: "Invalid Request" } 
    );
}

/**
 * newUser
 * 
 * HTTPS post request to create new user
 */
exports.newUser = functions.https.onRequest( (request, response) => {
    return cors(request, response, () => {
        if ( request.method !== "POST" ) {
            return invalidRequest( response );
        }

        const email = request.body.email;
        const password = request.body.password;
        const benefit  = request.body.benefit;

        admin.auth().createUser({
            email: email,
            password: password
        }).then( userRecord => {
            let dbs_record = {};
            dbs_record[userRecord.uid] = {
                email:  email,
                type:   20,
                benefit: benefit
            }
            console.log( "adding user: ", dbs_record );
            // save the new user to the DBS
            return admin.database().ref(`/users`).update(dbs_record)
        }).then( value => {
            return response.send( { success: true });
        }).catch( error => {
            return response.send( { success: false, error: error });
        });
    });
});

/**
 * balance
 * 
 * HTTPS POST request to get the account balances of a user id
 */
exports.balance = functions.https.onRequest((request, response) => {
    return cors(request, response, () => {
        if ( request.method !== "POST" || !request.body.user_id ){
            return invalidRequest( response );
        }
        // get the user_id from the request body
        const user_id = request.body.user_id;
        // get the user from the database
        admin.database().ref( `/users/${user_id}` ).once( 'value', snapshot => {
            let user = snapshot.val();
            // load the account Stellar for the user
            server.loadAccount( user.public_key ).then( account => {

                admin.database().ref( `/users/${user_id}` ).update(
                    { sequence_number: account.sequence }
                )
                
                return response.send({
                    success: true,
                    balance: account.balances[0].balance
                })
            }).catch( error => {
                return response.status(500).send(
                    { success: false, message: "Unable to load stellar account" }
                )
            }); // end stellar account
        }); // end database connection
    }); // end CORS
});

const createTransaction = ( destinationId, sourceKeypair, amount ) => {
    return server.loadAccount( destinationId )
        .then(() => {
            return server.loadAccount( sourceKeypair.publicKey() );
        })
        .then( sourceAccount => {
            let transaction = new StellarSdk.TransactionBuilder(sourceAccount)
                .addOperation(StellarSdk.Operation.payment({
                    destination: destinationId,
                    asset: StellarSdk.Asset.native(),
                    amount: amount.toString()
                }))
                .build();

            transaction.sign( sourceKeypair );

            return server.submitTransaction( transaction );
        })
}

/**
 * transaction
 * 
 * HTTPS endpoint to create a transaction between two accounts
 */
exports.transaction = functions.https.onRequest((request, response) => {
    return cors(request, response, () => {
        // validate the request
        if ( 
            request.method !== "POST" || 
            !(request.body.from && request.body.to && request.body.amount)
        ) {
            return invalidRequest( response );
        }
        // update the sequence number
        admin.database().ref( `/users/${request.body.from}/sequence_number` ).transaction( sequence_number => {
            return (sequence_number || 0) + 1;
        });
        // load all the users as we need two of them
        admin.database().ref('/users').once( 'value', snapshot => {
            const users = snapshot.val();
            // get the users
            const user_from = users[ request.body.from ];
            const user_to = users[ request.body.to ];
            // make sure that the two users exist
            if ( user_from === null || user_to === null ){
                return invalidRequest( request );
            }

            const sourceKeypair = StellarSdk.Keypair.fromSecret( user_from.secret );
            const destinationId = user_to.public_key;

            createTransaction( destinationId, sourceKeypair, request.body.amount )
                .catch( StellarSdk.NotFoundError, error => {
                    return invalidRequest( request );
                })
                .then( result => {
                    return response.send({
                        success: true,
                        message: "Transaction Approved"
                    });
                })
                .catch( error => {
                    return response.send({
                        success: false,
                        message: "Transaction Declined"
                    });
                });
        });
    });
});
