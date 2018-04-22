const functions = require('firebase-functions');

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

exports.createStellarSecret = functions.database.ref( "/users/{ user_id }" )
    .onWrite( (snapshot, context) => {
        console.log( snapshot, context );
    });