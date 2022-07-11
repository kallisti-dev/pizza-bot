require('dotenv').config();
const axios = require('axios');

async function run() {
    const { FB_CLIENT_ID, FB_CLIENT_SECRET} = process.env;
    const [token] = process.argv.splice(2);
    const { data: { access_token: user_access_token } } = await axios.get("https://graph.facebook.com/oauth/access_token", {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: FB_CLIENT_ID,
            client_secret: FB_CLIENT_SECRET,
            fb_exchange_token: token
        }
    });
    console.log();
    console.log(user_access_token);
}

run().catch(e => {console.log(e.response.data)});
