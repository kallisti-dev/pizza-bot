'use strict';
require('dotenv').config()

const { App, ExpressReceiver, LogLevel } = require('@slack/bolt');
const { ConsoleLogger } = require('@slack/logger');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const os = require('node:os');
const fs = require('node:fs');
const EmojiConverter = require('emoji-js');

const blocks = require('./blocks.js');
const models = require('./models');
const { FbClient } = require('./FbClient.js');
const { noThreads, noBots, onlyThreads, requireFbPageAccess } = require('./messageFilters.js');

const fatal = msg => {
    console.log(`ERROR: ${msg}`);
    process.exit(1);
}

/* Server config */
const hostname = process.env.HOSTNAME || os.hostname();
const port = process.env.PORT || 3000;

/* Slack App config */
const appId = process.env.SLACK_APP_ID || fatal('No SLACK_APP_ID environment variable');
const slackClientId = process.env.SLACK_CLIENT_ID || fatal('No SLACK_CLIENT_ID environment variable');
const slackClientSecret = process.env.SLACK_CLIENT_SECRET || fatal("No SLACK_CLIENT_SECRET environment variable");
const stateSecret = process.env.SLACK_STATE_SECRET || '4MHCSE0QVrUtQH4FHcf5KhBL';
// const token = process.env.SLACK_BOT_TOKEN || fatal("No SLACK_BOT_TOKEN environment variable");
const appToken = process.env.SLACK_APP_TOKEN || fatal("No SLACK_APP_TOKEN environment variable");
const userToken = process.env.SLACK_USER_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET || fatal("No SLACK_SIGNING_SECRET environment variable");
const socketMode = ['true', '1', 'yes'].includes((process.env.SLACK_SOCKET_MODE || '').toLowerCase());
const logLevel = process.env.LOG_LEVEL || LogLevel.WARN;
const slackScopes = ["channels:history", "chat:write", "chat:write.customize", "files:read", "files:write", "groups:history", "im:history", "im:write", "mpim:history", "users:read"];
const pizzaTimeImgPath = 'public/images/pizza-time.jpeg';

/* MongoDB config */
const mongoConnectUri = process.env.MONGO_CONNECT_URI || "mongodb://localhost:27017/pizza-bot";

/* Facebook App config */
const fbClientId = process.env.FB_CLIENT_ID || fatal("no FB_CLIENT_ID environment variable");
const fbClientSecret = process.env.FB_CLIENT_SECRET || fatal("no FB_CLIENT_SECRET environment variable");
const fbAppToken = `${fbClientId}|${fbClientSecret}`;

/* FB Error Codes */
const duplicateStatusCode = 506;
const expiredTokenErrorCodes = [190];
const invalidTokenErrorCodes = [100, 200];
const tokenErrorCodes = [...expiredTokenErrorCodes, ...invalidTokenErrorCodes];

/* FB Scopes */
const fbScopes = "pages_show_list pages_read_engagement pages_manage_engagement pages_manage_metadata pages_read_user_content pages_manage_posts publish_to_groups";

/* WebHooks */
const fbWebhookPath = process.env.FB_WEBHOOK_PATH || 'fb_webhook';

/* OAuth Redirect URIs */
const baseRedirectProtocol = process.env.BASE_REDIRECT_PROTOCOL || 'https'
const baseRedirectDomain = process.env.BASE_REDIRECT_DOMAIN || `${hostname}:${port}`;
const baseRedirectUri = `${baseRedirectProtocol}://${baseRedirectDomain}`
/* Slack Redirects */
const slackRedirectPath = `/slack/oauth_redirect`
const slackRedirectUri = `${baseRedirectUri}${slackRedirectPath}`;
/* Facebook Redirects */
const fbRedirectLoginPath = process.env.FB_REDIRECT_LOGIN_PATH || 'fb_login_callback';
const fbRedirectLoginUri = `${baseRedirectUri}/${fbRedirectLoginPath}`;
const fbRedirectPageAccessPath = process.env.FB_REDIRECT_PAGE_ACCESS_PATH || 'fb_page_access_callback';
const fbRedirectPageAccessUri = `${baseRedirectUri}/${fbRedirectPageAccessPath}`;

/* Bot Config */
const supportedFileTypes = ['jpeg', 'bmp', 'png', 'gif', 'tiff']

/* Emoji conversion settings */
const emoji = new EmojiConverter();
emoji.replace_mode = 'unified';
emoji.allow_caps = true;

/* Create logger */
const logger = new ConsoleLogger();

/* Create Express.js receiver */
const receiver = new ExpressReceiver({
    signingSecret,
    clientId: slackClientId,
    clientSecret: slackClientSecret,
    stateSecret,
    scopes: slackScopes,
    redirectUri: slackRedirectUri,
    installerOptions: {
        directInstall: true,
        redirectUriPath: slackRedirectPath,
        /* after slack installation, redirect to facebook login */
        callbackOptions: {
            success: (installation, installOptions, req, res) => {
                res.redirect(createFbClient().loginDialogUrl({ 
                    state: {
                        user: installation.user.id,
                        teamId: installation.team.id,
                    },
                    redirectUri: fbRedirectPageAccessUri
                }))
            }
        }
    },
    installationStore: {
        storeInstallation: installation => models.PizzaBot.updateSlackInstallation(installation.team.id, installation),
        fetchInstallation: installQuery => models.PizzaBot.getSlackInstallation({ teamId: installQuery.teamId }),
        deleteInstallation: installQuery => models.PizzaBot.remove({teamId: installQuery.teamId})
    },
    logger,
    logLevel
});
/* Install body-parser middleware for the Express router */ 
receiver.router.use(bodyParser.urlencoded({ extended: false }));
receiver.router.use(bodyParser.json());

/* Create Bolt App */
const app = new App({
    appToken,
    socketMode,
    receiver,
    logger,
    logLevel,
    deferInitialization: true
});

/* Helper to create a FbClient from environment config */
function createFbClient({pageAccessToken, pageId} = {}) {
    return new FbClient({
        clientId: fbClientId,
        clientSecret: fbClientSecret,
        pageAccessToken,
        pageId
    });
}

/* Facebook App Install Handler */
receiver.router.get(`/${fbRedirectPageAccessPath}`, async (req, res) => {
    if(req.query.error) {
        return res.status(400).send(req.query.error_description || req.query.error);
    }
    const code = req.query.code;
    if(!code) {
        logger.warn("No access code supplied in FB login reidrect");
        return res.status(400).send();
    }
    const fbClient = createFbClient();
    let userToken, pageList;
    /* Access the list of pages for this user */
    try {
        userToken = (await fbClient.getAccessToken({code, redirectUri: fbRedirectPageAccessUri})).access_token;
        const tokenInfo = await fbClient.debugToken(fbAppToken, userToken);
        logger.debug('user token info = ', tokenInfo);
        const userId = tokenInfo.user_id;
        pageList = await fbClient.getPageAccounts(userId, userToken);
        logger.info(`retrieved page access tokens for user: ${userId}`);
    } catch (e) {
        res.status(e.status ?? 500)
            .send(e?.message || 'could not retrieve Page Access Tokens');
        logger.error({
            path: e?.request?.path,
            error: e?.response?.data
        });
    }
    logger.debug('pageList = ', pageList);
    /* Check page list and use first result. We can only use one page per workspace */
    if(!pageList || pageList.length === 0) {
        return res.status(401).send('no page access given');
    }
    const { access_token: pageAccessToken, id: pageId } = pageList[0];
    /* log token info */
    if(logger.getLevel() === LogLevel.DEBUG) 
        logger.debug(await fbClient.debugToken(fbAppToken, pageAccessToken)
            .catch(e => logger.warn(e.response.data)));
    /* Subscribe to Webhooks  */
    fbClient.usePage(pageId, pageAccessToken);
    await fbClient.subscribeAppToPage()
        .then(() => logger.info(`subscribed to webhooks from page (page id: ${pageId})`))
        .catch(e => logger.error(e.response.data));
    const { user, teamId } = JSON.parse(req.query.state);
    /* Save access token in DB doc with associated Slack teamId */ 
    if(teamId) {
        await models.PizzaBot.updatePageAccessToken(teamId, pageAccessToken, pageId);
    } else {
        logger.warn(`no teamId for page access request (page id: ${pageId})`);
    }
    /* Save user access token so they don't have to login later */
    if(user) {
        await models.User.updateFbAccessToken(user, userToken);
        /* Send Installation Message on Slack */
        const token = await models.PizzaBot.getSlackToken({ pageId });
        app.client.files.upload({
                token,
                channels: user,
                initial_comment: ":pizza: It's Pizza Time! :pizza:",
                file: Buffer.from(fs.readFileSync(pizzaTimeImgPath))
        });
    } else {
        logger.warn(`no user for page access request (page id: ${pageId})`);
    }
    
    /* Redirect to Slack */
    res.redirect(`https://slack.com/app_redirect?app=${appId}&team=${teamId}`);
});

/* Facebook Login handler */
receiver.router.get(`/${fbRedirectLoginPath}`, async (req, res) => {
    if(req.query.error) {
        return res.status(400).send(req.query.error_description || req.query.error);
    }
    const { user, teamId } = JSON.parse(req.query.state);
    if(!user) {
        logger.warn('no user ID supplied in FB login redirect');
        return res.status(400).send();
    }
    const code = req.query.code;
    if(!code) {
        logger.warn("no access code supplied in FB login reidrect");
        return res.status(400).send();
    }
    const fbClient = createFbClient();
    let response, err;
    try {
        response = await fbClient.getAccessToken({code, redirectUri: fbRedirectLoginUri});
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
    } else if(response?.access_token) {
        /* Update database with token info */
        logger.info(`updating access token for user (id: ${user})`);
        await models.User.updateFbAccessToken(user, response.access_token);
    }
    if(err) {
        logger.error(err);
    }
    const token = await models.PizzaBot.getSlackToken({ teamId });
    if(token)
        await app.client.chat.postMessage({
            token,
            channel: user,
            text: err
                ? "Hmm something went wrong with granting permission to post on Facebook. Please try again or contact the app developer."
                : "Nice! You're now connected to Facebook."
        });
    res.redirect(`https://slack.com/app_redirect?app=${appId}&team=${teamId}`);
});


/* Bolt middleware that adds a FB API Client to the Bolt context and populates it with the team's FB Page Access Token */
async function withFbClient({context, logger, next}) {
    const { pageAccessToken, pageId } = await models.PizzaBot.fromTeamId(context.teamId);
    if(!pageAccessToken) logger.warn(`no page access token found for team (ID: ${context.teamId})`);
    if(!pageId) logger.warn(`no page access token found for team (ID: ${context.teamId})`);
    context.fbClient = createFbClient({pageAccessToken, pageId});
    await next();
}

/* Bolt middleware to add User data from DB into context */
async function withUserData({context, payload, logger, next}) {
    context.user = await models.User.find({slackUserId: payload.user});
    logger.debug('user = ', context.user);
    await next();
}

/* Generate the home view when user clicks on Home tab */
app.event('app_home_opened', async ({client, context, event}) => {
    await client.views.publish({
        user_id: event.user,
        view: blocks.homeView({
            fbLoginUrl: createFbClient().loginDialogUrl({
                state: {
                    user: event.user,
                    teamId: context.teamId
                },
                redirectUri: fbRedirectLoginUri
            })
        })
    });
});

/* Intercept messages with a pizza emoji */
app.message(noThreads, noBots, ':pizza:',
    withFbClient, requireFbPageAccess, withUserData,
    async({client, context, message, logger}) => {
        logger.debug('message = ', message);
        const { fbClient, user } = context;
        const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
        /* Fetch all Slack image attachments */
        const images = message.files &&
            await Promise.all(
                message.files
                .filter(file => supportedFileTypes.includes(file.filetype))
                .map(file => axios
                    .get(file.url_private, {
                        headers: { Authorization: `Bearer ${context.botToken}`},
                        responseType: 'stream'
                    }).then(({data}) => ({data, file}))
                )
            );
        /* Use User Access Token if available, otherwise use the default Page Access Token */
        const accessToken = user?.fbAccess?.token;
        /* Publish post via FB API */
        let tokenExpired = false,
            tokenInvalid = false,
            duplicatePost = false;
        const publishResult = await fbClient.publishPost({message: text, images, accessToken})
            /* If posting as user fails, try posting as page account instead */
            .catch(e => {
                logger.debug(e.response?.data);
                const code = e.response?.data?.error?.code;
                if(code && tokenErrorCodes.includes(code) && accessToken) {
                    return fbClient.publishPost({message: text, images});
                } else {
                    throw e;
                }
            /* Handle errors */
            }).catch(e => {
                logger.error('publishPost error = ', e.response?.data ?? e.message ?? e);
                const code = e.response?.data?.error?.code;
                tokenInvalid = invalidTokenErrorCodes.includes(code);
                tokenExpired = expiredTokenErrorCodes.includes(code);
                duplicatePost = (code === duplicateStatusCode);
            });
        logger.debug('publishResult = ', publishResult);
        if(publishResult?.id) {
            await models.Post.create({
                slackChannelId: message.channel,
                slackMsgId: message.ts,
                fbPostId: publishResult.id
            });
        }
        /* Send error messages to user on Slack */
        let errMsgToSlack;
        if(tokenInvalid) {
            errMsgToSlack = "I couldn't post this to Facebook because I do not have a valid permission to post to the page. The person who installed the Pizza Bot app should install it again on this workspace.";
        } else if (tokenExpired) {
            errMsgToSlack = "I couldn't post this to Facebook because the Page Access Token is either expired. The person who installed the Pizza Bot app needs to install it again on this workspace to refresh the access token. This should happen every 90 days according to Facebook policy.";
        } else if (duplicatePost) {
            errMsgToSlack = "I couldn't post this to Facebook because it was identical to the last post. Try posting something different, or delete your previous update.";
        }
        if(errMsgToSlack) {
            await client.chat.postEphemeral({
                channel: message.channel,
                user: message.user,
                text: errMsgToSlack
            });
        }
});

/* Intercept messages in threads */
app.message(onlyThreads, noBots, 
    withFbClient,
    requireFbPageAccess,
    async({client, context, message, logger}) => {
        /* find parent thread */
        logger.debug('message = ', message);
        const { fbClient, botToken } = context;
        const parentThread = await models.Post.findOne({slackMsgId: message.thread_ts});
        logger.debug('parentThread = ', parentThread);
        if(!parentThread || !parentThread.fbPostId) return;
        // const user = await models.User.findOne({slackUserId: message.user}).exec();
        // logger.debug(user);
        const text = emoji.replace_colons(message.text); //replace Slack :emoji: tokens with Unicode
        // facebook comments can only have one image attachment so we take the first one
        const file = message.files
            ?.filter(file => supportedFileTypes.includes(file.filetype))
            ?.at(0);
        // Download attached image file if it exists */
        const image = file && {
            file,
            data: (await axios.get(file.url_private, {
                headers: { Authorization: `Bearer ${botToken}`},
                responseType: 'stream'
            })).data
        };
        /* Post comment to FB */
        let tokenInvalid = false;
        const commentResult = await fbClient.postComment({
            postId: parentThread.fbPostId,
            message: text,
            image
        }).catch(e => {
            logger.error(e.response?.data);
            if(tokenErrorCodes.includes(e.response?.data?.error?.code)) // invalid token error
                tokenInvalid = true;
            else
                throw e;
        });
        logger.debug('commentResult = ', commentResult);
        if(tokenInvalid) {
            await client.chat.postEphemeral({
                channel: message.channel,
                user: message.user,
                text: "I couldn't post this to Facebook because the Page Access Token is either expired or does not grant enough permissions to post to the page. The person who installed the Pizza Bot app needs to install it again on this workspace to refresh the access token. This should happen every 90 days according to Facebook policy."
            });
        }
});

/* Facebook WebHook challenge */
receiver.router.get(`/${fbWebhookPath}`, async (req, res) => {
    logger.info(`/${fbWebookPath}`, req.query);
    res.send(req.query['hub.challenge']);
});

/* Facebook WebHook event handler */
receiver.router.post(`/${fbWebhookPath}`, async (req, res) => {
    logger.debug('WebHook payload = ', JSON.stringify(req.body, null, 4));
    if(req.body.object === 'page') {
        /* Grab comments */
        const comments = req.body.entry
            .flatMap(entry => entry.changes)
            .map(change => change.value)
            .filter(value => 
                value.item === 'comment' //only include comments
                && value.from.id !== value.post_id.split('_')[0]); // filter out comment if user id == page id
        for(const comment of comments) {
            let text;
            //comment verbs: add, edited, remove
            //TODO: add other verbs?
            if(comment.message && comment.verb === 'add') {
                text = `Facebook comment from ${comment.from.name}: ${comment.message}`;
            }
            if(text) {
                const postRecord = await models.Post.findOne({fbPostId: comment.post_id});
                logger.debug('postRecord = ', postRecord);
                // fetch Slack auth token
                const pageId = comment.post_id.split('_')[0];
                logger.debug(pageId);
                const token = await models.PizzaBot.getSlackToken({ pageId });
                logger.debug(token);
                if(token)
                    await app.client.chat.postMessage({
                        token,
                        channel: postRecord.slackChannelId,
                        thread_ts: postRecord.slackMsgId,
                        text
                    });
            }
        }
    }
    res.send();
})

/* Acknowledge when user clicks the facebook login button */
app.action('fb_login', async ({ack, body, logger}) => {
    // logger.debug(body);
    await ack();
});

/* Health check endpoint */
receiver.router.get('/health', async (req, res) => {
    const status = {
        db: mongoose.connection.readyState === mongoose.STATES.connected,
        slack: (await app.client.api.test()).ok,
    };
    if(status.db && status.slack) {
        logger.info('health check =', status);
        res.json(status);
    } else {
        logger.warn('health check = ', status);
        res.status(503).json(status);
    }
});

/* Configure static content middleware */
receiver.router.use(express.static('public'));

async function start() {
    /* Start mongo */
    logger.info(`connecting to ${mongoConnectUri} ...`);
    const mongoPromise = mongoose.connect(mongoConnectUri)
        .then(() => logger.info(`Connected to ${mongoConnectUri}`));
    /* Start Slack client */
    logger.info(`starting app server at ${hostname}:${port} ...`)
    await app.init();
    await app.start(port);
    logger.info(`app listening at ${hostname}:${port}`);
    await mongoPromise; //make sure Mongo finished connecting successfully
    logger.info('Pizza Bot is running! 🍕');
    /* Get App ID of our bot */
    logger.info(`Slack Install: ${baseRedirectUri}/slack/install`);
    // logger.info(`Facebook Login URL: ${createFbClient().loginDialogUrl({
    //     state: stateSecret,
    //     redirectUri: fbRedirectPageAccessUri,
    //     scope: fbScopes 
    // })}`);
}

start();