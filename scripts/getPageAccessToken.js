require('dotenv').config();
const axios = require('axios');

async function run() {
    const [userId, access_token] = process.argv.splice(2);
    const { data: { data: tokenList }  } = await axios.get(`https://graph.facebook.com/${userId}/accounts`, {
        params: {
            fields: "name,access_token",
            access_token
        }
    });

    console.log(tokenList);
}
run().catch(e => {console.log(e.response.data)});
