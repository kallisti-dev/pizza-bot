/* A module containing all the Views and Blocks for Slack messages */ 


const fbLoginButton = fbLoginUrl => (
    {
        "type": "button",
        "text": {
            "type": "plain_text",
            "text": "Login to Facebook"
        },
        "style": "primary",
        "action_id": "fb_login",
        "url": fbLoginUrl
    }
);

module.exports.homeView = ({fbLoginUrl}) => ({
    "type": "home",
    "blocks": [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "emoji": true,
                "text": "Pizza Bot :pizza:"
            }
        },
        {
            "type": "section",
            "text": {
                "type": "plain_text",
                "emoji": true,
                "text": "A simple bot that post memes to a Facebook page when a message contains the :pizza: emoji"
            }
        },
        {
            "type": "actions",
            "elements": [fbLoginButton(fbLoginUrl)]
        }
    ]
});

/* Dialog to prompt the user to login to facebook */
module.exports.loginToFacebookPrompt = ({text, url}) => (
    {
        text: `${text} Click this link so that I can login to Facebook and post comments for you: ${url}`,
        blocks: [
            {
                "type": "section",
                "text": {
                    "type": "plain_text",
                    "text": text
                }
            },
            {
                "type": "actions",
                "elements": [fbLoginButton(url)]
            }
        ]
    }
);