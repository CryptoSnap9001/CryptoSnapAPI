const functions = require('firebase-functions');
var request = require('request');
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

// The Firebase Admin SDK to access the Firebase Realtime Database.
const admin = require('firebase-admin');
admin.initializeApp();

// StellarSdk is required to connect to the Stellar blockchain network
var StellarSdk = require('stellar-sdk');

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