require('dotenv').config();
const { FbClient } = require('../src/fb_client.js');
const axios = require('axios');

async function run() {
    const { FB_CLIENT_ID, FB_CLIENT_SECRET} = process.env;
    const [token] = process.argv.splice(2);
    const fbClient = new FbClient({
        clientId: FB_CLIENT_ID,
        clientSecret: FB_CLIENT_SECRET
    });
    const appToken = (await fbClient.getAppAccessToken()).access_token;
    const tokenInfo = await fbClient.debugToken(appToken, token);
    console.log(tokenInfo);
}

run();
