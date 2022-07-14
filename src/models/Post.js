const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    slackChannelId: {type: String, required: true },
    slackMsgId: { type: String, required: true },
    // slackParentMsgId: String,
    fbPostId: String,
    // fbCommentId: String
});

const Post = mongoose.model('Post', PostSchema);

module.exports = {
    Post,
    PostSchema
};