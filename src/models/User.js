const mongoose = require('mongoose');

const FbAccessSchema = new mongoose.Schema({
    status: 'allowed' | 'rejected' | 'expired' | 'notified',
    token: String,
    lastNotification: Date
});

const UserSchema = new mongoose.Schema({
    slackUserId: {
        type: String,
        unique: true,
        required: true
    },
    fbAccess: FbAccessSchema
});


UserSchema.statics.updateFbAccessToken = async (slackUserId, token) => {
    return this.model.updateOne(
        { slackUserId },
        { $set: {
            'fbAccess.token': token,
            'fbAccess.status': 'allowed'
        }},
        {upsert: true}
    );
};

const User = mongoose.model('User', UserSchema);

module.exports = {
    User,
    UserSchema,
    FbAccessSchema
};