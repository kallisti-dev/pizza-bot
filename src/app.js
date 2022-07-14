require('dotenv').config()

const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const { ConsoleLogger } = require('@slack/logger');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const os = require('node:os');
const EmojiConverter = require('emoji-js');

const blocks = require('./blocks.js');
const models = require('./models');
const { FbClient } = require('./FbClient.js');
const { noThreads, noBots, onlyThreads } = require('./messageFilters.js');

/* Server config */
const hostname = process.env.HOSTNAME || os.hostname();
const port = process.env.PORT || 3000;

/* Slack App config */
const appId = process.env.APP_ID;
const token = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_TOKEN;
const userToken = process.env.SLACK_USER_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const socketMode = ['true', '1', 'yes'].includes((process.env.SLACK_SOCKET_MODE || '').toLowerCase());
const logLevel = process.env.LOG_LEVEL || LogLevel.WARN;

/* Facebook App config */
const fbClientId = process.env.FB_CLIENT_ID;
const fbClientSecret = process.env.FB_CLIENT_SECRET;
// FB base redirect config
const fbRedirectProtocol = process.env.FB_REDIRECT_PROTOCOL || 'https'
const fbRedirectDomain = process.env.FB_REDIRECT_DOMAIN || `${hostname}:${port}`;
const fbRedirectBaseUri = `${fbRedirectProtocol}://${fbRedirectDomain}`
// FB login redirect config
const fbRedirectLoginPath = process.env.FB_LOGIN_REDIRECT_PATH || 'fb_login_callback';
const fbRedirectLoginUri = `${fbRedirectBaseUri}/${fbRedirectLoginPath}`;
// FB page access redirect config
const fbRedirectPageAccessPath = process.env.FB_PAGE_ACCESS_REDIRECT_PATH || 'fb_page_access_callback';
const fbRedirectPageAccessUri = `${fbRedirectBaseUri}/${fbRedirectPageAccessPath}`;

const fbWebhookPath = process.env.FB_WEBHOOK_PATH || 'fb_webhook';

/* MongoDB config */
const mongoConnectUri = process.env.MONGO_CONNECT_URI || "mongodb://localhost:27017/pizza-bot";

/* Bot Config */
const supportedFileTypes = ['jpeg', 'bmp', 'png', 'gif', 'tiff'];
const expiredTokenErrorCodes = [190];
const invalidTokenErrorCodes = [200]
const tokenErrorCodes = [...expiredTokenErrorCodes, ...invalidTokenErrorCodes];

/* Emoji conversion settings */
const emoji = new EmojiConverter();
emoji.replace_mode = 'unified';
emoji.allow_caps = true;


/* Create Fb API Client */
// const fbClient = new FbClient({
//     clientId: fbClientId ,
//     clientSecret: fbClientSecret,
//     loginRedirectUri: fbRedirectLoginUri,
//     // pageId: fbPageId,
//     // pageAccessToken: fbPageAccessToken
// });

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

/* health check */
receiver.router.get('/', async (req, res) => {
    logger.info('Health Check - Status OK');
    await res.send();
});

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
app.event('app_home_opened', async ({client, event}) => {
    await client.views.publish({
        user_id: event.user,
        view: blocks.homeView
    });
});

function createFbClient({pageAccessToken, pageId} = {}) {
    return new FbClient({
        clientId: fbClientId,
        clientSecret: fbClientSecret,
        redirectLoginUri: fbRedirectLoginUri,
        pageAccessToken,
        pageId
    });
}

/* Bolt middleware that adds a FB API Client to the Bolt context and populates it with the team's FB Page Access Token */
async function addFbClientToContext({context, logger, next}) {
    const { pageAccessToken, pageId } = await models.PizzaBot.fromTeamId(context.teamId);
    if(!pageAccessToken) logger.warn(`No page access token found for team (ID: ${context.teamId})`);
    if(!pageId) logger.warn(`No page access token found for team (ID: ${context.teamId})`);
    context.fbClient = createFbClient({pageAccessToken, pageId});
    await next();
}

/* Intercept messages with a pizza emoji */
app.message(noThreads, noBots, ':pizza:',
    addFbClientToContext,
    async({client, context, message, logger}) => {
        logger.debug(message);
        const { fbClient } = context;
        let tokenValid = true;
        const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
        const images = message.files &&
            await Promise.all(
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
        const publishResult = await fbClient.publishPost({message: text, images}).catch(e => {
            logger.error(e.response?.data);
            if(tokenErrorCodes.includes(e.response?.data?.error?.code)) // invalid token error
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
            await client.chat.postEphemeral({
                channel: message.channel,
                user: message.user,
                text: "I couldn't post this to Facebook because the Page Access Token is either expired or does not grant enough permissions to post to the page"
            });
        }
});

/* Intercept messages in threads */
app.message(onlyThreads, noBots, 
    addFbClientToContext,
    async({client, context, message, logger}) => {
        /* find parent thread */
        logger.debug(message);
        const { fbClient } = context;
        const parentThread = await models.Post.findOne({slackMsgId: message.thread_ts});
        logger.debug(parentThread);
        if(!parentThread || !parentThread.fbPostId) return;
        // const user = await models.User.findOne({slackUserId: message.user}).exec();
        // logger.debug(user);
        let tokenValid = true;
        const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
        // facebook comments can only have one image attachment so we take the first one
        const file = message.files
            ?.filter(file => supportedFileTypes.includes(file.filetype))
            ?.at(0);
        // Download attached image file if it exists */
        const image = file && {
            file,
            data: (await axios.get(file.url_private, {
                headers: { Authorization: `Bearer ${token}`},
                responseType: 'stream',
                decompress: true
            })).data
        };
        /* Post comment to FB */
        const commentResult = await fbClient.postComment({
            postId: parentThread.fbPostId,
            message: text,
            image
        }).catch(e => {
            logger.error(e.response?.data);
            if(invalidTokenCodes.includes(e.response?.data?.error?.code)) // invalid token error
                tokenValid = false;
            else
                throw e;
        });
        logger.debug(commentResult);
        if(!tokenValid) {
            await client.chat.postEphemeral({
                channel: message.channel,
                user: message.user,
                text: "I couldn't post this to Facebook because the Page Access Token is either expired or does not grant enough permissions to post to the page"
            });
        }
        // if(!tokenValid) {
        //     await client.chat.postEphemeral({
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
receiver.router.get(`/${fbRedirectPageAccessPath}`, async (req, res) => {
    const fbClient = createFbClient();
    let output;
    try {
        const userToken = (await fbClient.getAccessToken(req.query.code)).access_token;
        const appToken = (await fbClient.getAppAccessToken()).access_token;
        const userId = (await fbClient.debugToken(appToken, userToken)).user_id;
        output = await fbClient.getPageAccounts(userId, userToken);
        logger.info(`Received page access tokens for user: ${userId}`);
        logger.debug('user pages: ', output);
        res.json(output);
    } catch (e) {
        res.status(e.status ?? 500);
        res.send(e?.message || 'Could not retrieve Page Access Tokens');
    }
});

receiver.router.get(`/${fbRedirectLoginPath}`, async (req, res) => {
    let response, err;
    const { user } = JSON.parse(req.query.state);
    if(!user) {
        logger.warn('No user ID supplied in FB login redirect');
        return;
    }
    const code = req.query.code;
    if(!code) {
        logger.warn("No access code supplied in FB login reidrect");
        return;
    }
    try {
        response = await fbClient.getAccessToken(code);
    } catch(e) {
        err = {
            userId: user,
            message: e.message,
            host: e.request?.host,
            path: e.request?.path,
            response: e.response?.data
        };
    }
    if(response?.data?.error) {
        err = {
            userId: user,
            host: response.request?.host,
            path: response.request?.path,
            ...response.data.error
        };
    } else if(response?.data?.access_token) {
        /* Update database with token info */
        await models.User.updateFbAccessToken(user, response.data.access_token);
    }
    if(err) {
        logger.error(err);
    }
    await app.client.chat.postMessage({
        token,
        channel: user,
        text: err
            ? "Hmm something went wrong with granting permission to post on Facebook. Please try again or contact the app developer."
            : "Nice! You can now share memes to Facebook. :pizza:"

    });
    res.redirect(`https://slack.com/app_redirect?app=${appId}`);
});

/* Acknowledge when user clicks the facebook login button */
app.action('fb_login', async ({ack, body, logger}) => {
    logger.debug(body);
    await ack();
});

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
    await mongoPromise; //make sure Mongo finished connecting successfully
    logger.info('Pizza Bot is running! 🍕');
    /* Get App ID of our bot */
    logger.info(`Facebook Login URL: ${createFbClient().loginDialogUrl({state: appId, redirectUri: fbRedirectPageAccessUri})}`);
}

start();