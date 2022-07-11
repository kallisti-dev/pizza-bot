/* Module containing our MongoDB models */
const mongoose = require('mongoose');
    
// const userSchema = new mongoose.Schema({
//     slackUserId: {
//         type: String,
//         unique: true,
//         required: true
//     },
//     fbAccessToken: String
// });

const postSchema = new mongoose.Schema({
    slackChannelId: {type: String, required: true },
    slackMsgId: { type: String, required: true },
    // slackParentMsgId: String,
    fbPostId: String,
    // fbCommentId: String
})

// const pizzaBotSchema = new mongoose.Schema({
//     slackAppId: {
//         type: String,
//         unique: true,
//         required: true
//     },
//     slackTeamId: {
//         type: String,
//         unique: true,
//         required: true
//     },
//     fbPageAccessToken: String,
// });

/* Fetch or Create bot state in DB */
// async function getPizzaBot() {
//     /* Get App ID of our bot and Team ID of the workspace */
//     const { bot_id, team_id } = await app.client.auth.test({ token });
//     const { bot: { app_id } } = await app.client.bots.info({ token, bot: bot_id });
//     /* Find in DB or create if not found */
//     const doc = { slackAppId: app_id, slackTeamId: team_id };
//     return await models.PizzaBot.findOne(doc)
//         ?? await models.PizzaBot.create(doc);
// }

module.exports = {
    // User: mongoose.model('User', userSchema),
    Post: mongoose.model('Post', postSchema)
    // PizzaBot: mongoose.model('PizzaBot', pizzaBotSchema)
};