const request = require('request');
const functions = require('firebase-functions');
// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();
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
const createStellarAccount = ( pair ) => {
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
        // generate the keys that we need
        var pair = StellarSdk.Keypair.random(); // generate the key
        // create a wallet for them in the background
        console.log( `Creating stellar account for ${user_id}` );
        createStellarAccount( pair );
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
 * balance
 * 
 * HTTPS POST request to get the account balances of a user id
 */
exports.balance = functions.https.onRequest((request, response) => {
    if ( request.method !== "POST" || !request.body.user_id ){
        return invalidRequest( response );
    }
    // get the user_id from the request body
    const user_id = request.body.user_id;
    // get the user from the database
    admin.database().ref( `/users/${user_id}` ).on( 'value', snapshot => {
        let user = snapshot.val();
        // load the account Stellar for the user
        server.accounts()
            .accountId( user.public_key )
            .call()
            .then( accountResult => {
                return response.send( {
                    success: true,
                    balances: accountResult.balances
                });
            }).catch( error => {
                return response.send(
                    { success: false, message: "Unable to load stellar account" }
                )
            });
    });
});

/**
 * transaction
 * 
 * HTTPS endpoint to create a transaction between two accounts
 */

exports.transaction = functions.https.onRequest((request, response) => {
    // validate the request
    if ( 
        request.method !== "POST" || 
        !(request.body.from && request.body.to && request.body.amount)
    ) {
        return invalidRequest( response );
    }
    // load all the users as we need two of them
    admin.database().ref('/users').on( 'value', snapshot => {
        const users = snapshot.val();
        // get the users
        const user_from = users[ request.body.from ];
        const user_to = users[ request.body.to ];
        // make sure that the two users exist
        if ( user_from === null || user_to === null ){
            return invalidRequest( request );
        }

        const sourceKeypair = StellarSdk.Keypair.fromSecret( user_from.secret );
        const receiverPublicKey = user_to.public_key;

        let account = new StellarSdk.Account( sourceKeypair.publicKey(), user_from.sequence_number );
        let transaction = new StellarSdk.TransactionBuilder( account )
            .addOperation( StellarSdk.Operation.payment({
                destination: receiverPublicKey,
                asset:  StellarSdk.Asset.native(),
                amount: request.body.amount.toString()
            }))
            .build();
        transaction.sign( sourceKeypair );

        // update the sequence number
        admin.database().ref( `/users/${request.body.from}` ).update({
            sequence_number: user_from.sequence_number + 1
        });

        server.submitTransaction( transaction ).then( result => {
            return response.send( result );
        }).catch( error => {
            return response.send( error );
        });
    });
});