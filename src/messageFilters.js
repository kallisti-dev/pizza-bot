
module.exports.noBots = async ({ message, next }) => {
    if (!message.subtype || message.subtype !== 'bot_message') {
        await next()
    }
}

module.exports.noThreads = async ({message, next}) => {
    if(!message.thread_ts) {
        await next()
    }
}

module.exports.onlyThreads = async ({message, next}) => {
    if(message.thread_ts) {
        await next()
    }
}

/* Requires that a FB client is initialized in the context with valid page ID and page access token */
module.exports.requireFbPageAccess = async ({context, next}) => {
    const { fbClient } = context;
    if(fbClient && fbClient.pageId && fbClient.pageAccessToken) {
        await next()
    }
}
