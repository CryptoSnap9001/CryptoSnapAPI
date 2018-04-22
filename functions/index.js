const request = require('request');
const functions = require('firebase-functions');
// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();
// StellarSdk is required to connect to the Stellar blockchain network
var StellarSdk = require('stellar-sdk');
// Connect to the Stellar Horizon Server
var server = new StellarSdk.Server('https://horizon-testnet.stellar.org');

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
    }, function(error, response, body) {
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
                public_key: pair.publicKey()
            });
    });

/**
 * balance
 * 
 * HTTPS POST request to get the account balances of a user id
 */
exports.balance = functions.https.onRequest((request, response) => {
    if ( request.method !== "POST" || !request.body.user_id ){
        return response.status(400).send(
            { success: false, message: "Invalid Request" } 
        );
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