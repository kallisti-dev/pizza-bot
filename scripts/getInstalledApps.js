require('dotenv').config();
const { FbClient } = require('../src/fb_client.js');
const axios = require('axios');

async function run() {
    const { FB_CLIENT_ID, FB_CLIENT_SECRET, FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN} = process.env;
    const fbClient = new FbClient({
        clientId: FB_CLIENT_ID,
        clientSecret: FB_CLIENT_SECRET,
        pageId: FB_PAGE_ID,
        pageAccessToken: FB_PAGE_ACCESS_TOKEN
    });
    const response = await fbClient.getInstalledApps();
    console.log(response.data ?? response);
}

run().catch(e => {console.log(e.response?.data ?? e.error ?? e.message)});
