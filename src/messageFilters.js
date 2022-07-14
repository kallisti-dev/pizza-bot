
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
