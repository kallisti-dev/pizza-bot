const mongoose = require('mongoose');

const PizzaBotSchema = new mongoose.Schema({
    teamId: {
        type: String,
        unique: true
    },
    pageAccessToken: String,
    pageId: String
});

PizzaBotSchema.statics.updatePageAccessToken = function (teamId, pageAccessToken, pageId) {
    return this.updateOne(
        teamId,
        { pageAccessToken, pageId },
        { upsert: true }
    );
};

PizzaBotSchema.statics.fromTeamId = async function (teamId) {
    return await this.findOne({ teamId })
        ?? await this.create({ teamId })
}

const PizzaBot = mongoose.model("PizzaBot", PizzaBotSchema);

module.exports = {
    PizzaBot,
    PizzaBotSchema
};