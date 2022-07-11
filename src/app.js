require('dotenv').config()

const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const { ConsoleLogger } = require('@slack/logger');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const os = require('node:os');
const EmojiConverter = require('emoji-js');

const blocks = require('./blocks.js');
const models = require('./models.js');
const { FbClient } = require('./fb_client.js');
const { noThreads, noBots, onlyThreads } = require('./listener-middleware.js');
const { fstat } = require('node:fs');

/* Server config */
const hostname = process.env.HOSTNAME || os.hostname();
const port = process.env.PORT || 3000;

/* Slack App config */
const token = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
const userToken = process.env.SLACK_USER_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const socketMode = ['true', '1', 'yes'].includes((process.env.SLACK_SOCKET_MODE || '').toLowerCase());
const logLevel = process.env.LOG_LEVEL || LogLevel.WARN;

/* Facebook App config */
const fbClientId = process.env.FB_CLIENT_ID;
const fbClientSecret = process.env.FB_CLIENT_SECRET;
const fbPageId = process.env.FB_PAGE_ID;
const fbPageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN;
const fbRedirectProtocol = process.env.FB_REDIRECT_PROTOCOL || 'https'
const fbRedirectDomain = process.env.FB_REDIRECT_DOMAIN || `${hostname}:${port}`;
const fbRedirectPath = process.env.FB_REDIRECT_PATH || 'fb_login_callback';
const fbRedirectUri = `${fbRedirectProtocol}://${fbRedirectDomain}/${fbRedirectPath}`;
const fbWebhookPath = process.env.FB_WEBHOOK_PATH || 'fb_webhook';

/* MongoDB config */
const mongoConnectUri = process.env.MONGO_CONNECT_URI || "mongodb://localhost:27017/pizza-bot";

/* Slack IDs that we fetch after initialization */
let appId, teamId;

/* Bot Config */
const supportedFileTypes = ['jpeg', 'bmp', 'png', 'gif', 'tiff'];

/* Emoji conversion settings */
const emoji = new EmojiConverter();
emoji.replace_mode = 'unified';
emoji.allow_caps = true;


/* Create Fb API Client */
const fbClient = new FbClient({
    clientId: fbClientId ,
    clientSecret: fbClientSecret,
    redirectUri: fbRedirectUri,
    pageId: fbPageId,
    pageAccessToken: fbPageAccessToken
});

/* Create logger */
const logger = new ConsoleLogger();

/* Create Express.js receiver */
const receiver = new ExpressReceiver({
    signingSecret,
    logger,
    logLevel
});
/* Install body-parser middleware for the Express router */ 
receiver.router.use(bodyParser.urlencoded({ extended: false }));
receiver.router.use(bodyParser.json());

/* Create Slack App */
const app = new App({
    token,
    appToken,
    socketMode,
    deferInitialization: true,
    receiver,
    logger,
    logLevel
});

/* Generate the home view when user clicks on Home tab */
app.event('app_home_opened', async ({event}) => {
    await app.client.views.publish({
        token,
        user_id: event.user,
        view: blocks.homeView
    });
});

/* Intercept messages with a pizza emoji */
app.message(noThreads, noBots, ':pizza:', async({message, say, logger}) => {
    logger.debug(message);
    let publishPromise;
    let tokenValid = true;
    const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
    if(message.files) {
        const images = await Promise.all(
            message.files
            .filter(file => supportedFileTypes.includes(file.filetype))
            .map(file => axios
                .get(file.url_private, {
                    headers: { Authorization: `Bearer ${token}`},
                    responseType: 'stream',
                    decompress: true
                }).then(({data}) => ({data, file}))
            )
        );
        publishPromise = fbClient.publishPhotoPost({message: text, images});
    } else {
        publishPromise = fbClient.publishTextPost({message: text});
    }
    const publishResult = await publishPromise.catch(e => {
        logger.error(e.response?.data);
        if([190, 200].includes(e.response?.data?.error?.code)) // invalid token error
            tokenValid = false;
        else
            throw e;
    });
    logger.debug(publishResult);
    if(publishResult?.id) {
        await models.Post.create({
            slackChannelId: message.channel,
            slackMsgId: message.ts,
            fbPostId: publishResult.id
        });
    }
    if(!tokenValid) {
        await app.client.chat.postEphemeral({
            token,
            channel: message.channel,
            user: message.user,
            text: "I couldn't post this to Facebook because the Page Access Token is either expired or does not grant enough permissions to post to the page"
        });
    }
});

/* Intercept messages in threads */
app.message(onlyThreads, noBots, async({message, say, logger}) => {
    /* find parent thread */
    logger.debug(message);
    const parentThread = await models.Post.findOne({slackMsgId: message.thread_ts});
    logger.debug(parentThread);
    if(!parentThread || !parentThread.fbPostId) return;
    // const user = await models.User.findOne({slackUserId: message.user}).exec();
    // logger.debug(user);
    let tokenValid = true;
    const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
    let image = null;
    if(message.files) {
        //facebook comments can only have one image attachment so we take the first one
        const file = message.files
            .filter(file => supportedFileTypes.includes(file.filetype))
            [0];
        if(file) {
            const response = await axios.get(file.url_private, {
                headers: { Authorization: `Bearer ${token}`},
                responseType: 'stream',
                decompress: true
            });
            image = { file, data: response.data };
        }
    }
    const commentResult = await fbClient.postComment({
        postId: parentThread.fbPostId,
        message: text,
        image
    }).catch(e => {
        logger.error(e.response?.data);
        if([190, 200].includes(e.response?.data?.error?.code)) // invalid token error
            tokenValid = false;
        else
            throw e;
    });
    logger.debug(commentResult);
    if(!tokenValid) {
        await app.client.chat.postEphemeral({
            token,
            channel: message.channel,
            user: message.user,
            text: "I couldn't post this to Facebook because the Page Access Token is either expired or does not grant enough permissions to post to the page"
        });
    }
    // if(!tokenValid) {
    //     await app.client.chat.postEphemeral({
    //         token,
    //         channel: message.channel,
    //         user: message.user,
    //         ...blocks.loginToFacebookPrompt({
    //             text: "I couldn't post this to Facebook because I don't have your permission. You'll need to give me permission by clicking the login button below. After you're finished, try sending the message again.",
    //             url: fbClient.loginDialogUrl({user: message.user})
    //         })
    //     });
    // }
    
});

/* Facebook WebHook challenge */
receiver.router.get(`/${fbWebhookPath}`, async (req, res) => {
    console.log(req.query);
    res.send(req.query['hub.challenge']);
});

/* Facebook WebHook event handler */
receiver.router.post(`/${fbWebhookPath}`, async (req, res) => {
    logger.info('WebHook payload = ', JSON.stringify(req.body, null, 4));
    if(req.body.object === 'page') {
        /* Grab comments */
        const comments = req.body.entry
            .flatMap(entry => entry.changes)
            .filter(change => 
                change.value.item === 'comment' //only include comments
                && change.value.from.id !== fbPageId) // filter out comments from the page itself
            .map(change => change.value);
        for(const comment of comments) {
            //comment verbs: add, edited, remove
            const postRecord = await models.Post.findOne({fbPostId: comment.post_id});
            logger.debug('postRecord = ', postRecord);
            let text;
            if(comment.verb === 'add') {
                text = `Facebook comment from ${comment.from.name}: ${comment.message}`;
            }
            //TODO: add other verbs?
            if(text) {
                await app.client.chat.postMessage({
                    token,
                    channel: postRecord.slackChannelId,
                    thread_ts: postRecord.slackMsgId,
                    text
                })
            }
        }
    }
    res.send();
})

/* Facebook Login handler */
receiver.router.get(`/${fbRedirectPath}`, async (req, res) => {
    let output;
    try {
        const userToken = (await fbClient.getAccessToken(req.query.code)).access_token;
        const appToken = (await fbClient.getAppAccessToken()).access_token;
        const userId = (await fbClient.debugToken(appToken, userToken)).user_id;
        output = await fbClient.getPageAccounts(userId, userToken);
        logger.info(`Received page access tokens for user: ${userId}`);
        logger.debug('user pages: ', output);
    } catch (e) {
        res.status(e.status ?? 500);
        res.send(e);
    }
    if(output) {
        res.json(output);
    } else {
        logger.info('Could not retrieve Paga Access Tokens')
        res.send('Could not retrieve Paga Access Tokens');
    }
});

// receiver.router.get(`/${fbRedirectPath}`, async (req, res) => {
//     let response, err;
//     const { user } = JSON.parse(req.query.state);
//     try {
//         response = await fbClient.getAccessToken(req.query.code);
//     } catch(e) {
//         err = {
//             userId: user,
//             message: e.message,
//             host: e.request?.host,
//             path: e.request?.path,
//             response: e.response?.data
//         };
//     }
//     if(response?.data?.error) {
//         err = {
//             userId: user,
//             host: response.request?.host,
//             path: response.request?.path,
//             ...response.data.error
//         };
//     } else if(response?.data?.access_token) {
//         /* Update database with token info */
//         await models.User.updateOne(
//             {slackUserId: user},
//             {fbAccessToken: response.data.access_token},
//             {upsert: true}
//         ).exec();
//     }
//     if(err) {
//         logger.error(err);
//     }
//     await app.client.chat.postMessage({
//         token,
//         channel: user,
//         text: err
//             ? "Hmm something went wrong with granting permission to post on Facebook. Please try again or contact the app developer."
//             : "Nice! You can now share memes to Facebook. :pizza:"

//     });
//     res.redirect(`https://slack.com/app_redirect?app=${appId}`);
// });

/* Acknowledge when user clicks the facebook login button */
// app.action('fb_login', async ({ack, body, logger}) => {
//     logger.debug(body);
//     await ack();
// });

async function start() {
    /* Start mongo */
    logger.info(`Connecting to ${mongoConnectUri} ...`);
    const mongoPromise = mongoose.connect(mongoConnectUri)
        .then(() => logger.info(`Connected to ${mongoConnectUri}`));
    /* Start Slack client */
    logger.info(`Starting app server at ${hostname}:${port} ...`)
    await app.init();
    await app.start(port);
    logger.info(`App listening at ${hostname}:${port}`);

    /* Get App ID of our bot and Team ID of the workspace */
    const { bot_id, team_id } = await app.client.auth.test({ token });
    const { bot: { app_id } } = await app.client.bots.info({ token, bot: bot_id });

    teamId = team_id;
    appId = app_id;
    logger.debug(`app_id = ${appId}`);
    logger.debug(`team_id = ${teamId}`);

    await mongoPromise; //make sure Mongo finished connecting successfully
    logger.info('Pizza Bot is running! 🍕');
    logger.info(`Facebook Login URL: ${fbClient.loginDialogUrl(appId)}`);
}

start();