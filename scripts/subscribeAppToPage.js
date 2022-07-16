require('dotenv').config();
const { FbClient } = require('../src/fb_client.js');
const axios = require('axios');

async function run() {
    const [pageId, pageAccessToken] = process.argv.splice(2);
    const { FB_CLIENT_ID, FB_CLIENT_SECRET } = process.env;
    const fbClient = new FbClient({
        clientId: FB_CLIENT_ID,
        clientSecret: FB_CLIENT_SECRET,
        pageId,
        pageAccessToken
    });
    const response = await fbClient.subscribeAppToPage();
    console.log(response.data ?? response);
}

run().catch(e => {console.log(e.response?.data ?? e.error ?? e.message)});
