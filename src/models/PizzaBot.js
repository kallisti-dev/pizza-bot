const mongoose = require('mongoose');

const PizzaBotSchema = new mongoose.Schema({
    teamId: {
        type: String,
        unique: true
    },
    installation: Object,
    pageAccessToken: String,
    pageId: String
});

PizzaBotSchema.statics.updateSlackInstallation = function (teamId, installation) {
    return this.updateOne(
        { teamId },
        { teamId, installation},
        { upsert: true }
    );
};

PizzaBotSchema.statics.updatePageAccessToken = function (teamId, pageAccessToken, pageId) {
    return this.updateOne(
        { teamId },
        { teamId, pageAccessToken, pageId },
        { upsert: true }
    );
};

PizzaBotSchema.statics.fromTeamId = async function (teamId) {
    return await this.findOne({ teamId })
        ?? await this.create({ teamId })
}

PizzaBotSchema.statics.getSlackInstallation = function (query) {
    return this.findOne(query).then(pb => pb.installation);
}

PizzaBotSchema.statics.getSlackToken = function (query) {
    return this.findOne(query).then(pb => pb.installation?.bot?.token);
}

const PizzaBot = mongoose.model("PizzaBot", PizzaBotSchema);

module.exports = {
    PizzaBot,
    PizzaBotSchema
};