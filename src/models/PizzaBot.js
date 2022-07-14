const mongoose = require('mongoose');

const PizzaBotSchema = new mongoose.Schema({
    teamId: {
        type: String,
        unique: true
    },
    pageAccessToken: String,
    pageId: String
});

PizzaBotSchema.statics.updatePageAccessToken = (teamId, pageAccessToken, pageId) => {
    return this.updateOne(
        teamId,
        { pageAccessToken, pageId },
        { upsert: true }
    );
};

PizzaBotSchema.statics.fromTeamId = async (teamId) => {
    return this.model.findOne({teamId});
}

const PizzaBot = mongoose.model("PizzaBot", PizzaBotSchema);

module.exports = {
    PizzaBot,
    PizzaBotSchema
};