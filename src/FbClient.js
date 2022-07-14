const querystring = require('node:querystring');
const axios = require('axios');
const FormData = require('form-data');


module.exports.FbClient = class FbClient {

    constructor(fields) {
        this.clientId = fields.clientId;
        this.clientSecret = fields.clientSecret;
        this.pageId = fields.pageId;
        this.pageAccessToken = fields.pageAccessToken;

        /* create axios instance */
        this.axios = axios.create({
            baseURL: 'https://graph.facebook.com/v14.0'
        });
    }

    /* Retrieve the URL for Facebook Login dialog */
    loginDialogUrl({redirectUri, state}) {
        return `https://www.facebook.com/v14.0/dialog/oauth?` + querystring.stringify({
            client_id: this.clientId,
            redirect_uri: redirectUri,
            state: JSON.stringify(state || '')
        });
    }

    getAppAccessToken() {
        return this.axios.get('/oauth/access_token', {
            params: { 
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: 'client_credentials'
            }
        }).then(response => response.data);
    }

    debugToken(appToken, inputToken) {
        return this.axios.get('/debug_token', {
            params: {
                access_token: appToken,
                input_token: inputToken
            }
        }).then(response => response.data.data ?? response.data);
    }

    /* List pages owned by account */
    getPageAccounts(userId, accessToken) {
        return this.axios.get(`/${userId}/accounts`, {
            params: {
                fields: 'name, access_token',
                access_token: accessToken
            }
        }).then(response => response.data.data ?? response.data);
    }
    
    /* Given a FB access code, retrieve an access token */
    getAccessToken({code, redirectUri}) {
        return this.axios.get('/oauth/access_token', {
            params: {
                client_id: this.clientId,
                client_secret: this.clientSecret,
                redirect_uri: redirectUri,
                code
            }
        }).then(response => response.data);
    }

    subscribeAppToPage() {
        return this.axios.post(`${this.pageId}/subscribed_apps`, {
            subscribed_fields: 'feed',
            access_token: this.pageAccessToken
        });
    }

    getInstalledApps() {
        return this.axios.get(`${this.pageId}/subscribed_apps`, {
            params: {
                access_token: this.pageAccessToken
            }
        });
    }

    publishPost({message, images, accessToken}) {
        if(images) {
            return fbClient._publishPhotoPost({message, images, accessToken});
        } else {
            return fbClient._publishTextPost({message, accessToken});
        }
    }

    _publishTextPost({message, accessToken}) {
        return this.axios.post(`/${this.pageId}/feed`, {
            message,
            access_token: accessToken || this.pageAccessToken
        }).then(response => response.data);
    }

    async _publishPhotoPost({message, images, accessToken}) {
        const singleImage = (images.length === 1);
        const photoResults = await Promise.all(images.map(async ({data, file}) => {
            const formData = new FormData();
            singleImage && formData.append('caption', message);
            formData.append('published', JSON.stringify(singleImage));
            formData.append('access_token', accessToken || this.pageAccessToken);
            formData.append('source', data, {
                filename: file.name,
                contentType: file.mimetype,
                knownLength: file.size
            });
            const response = await this.axios.post(`/${this.pageId}/photos`, formData, {
                headers: formData.getHeaders()
            });
            return response.data
        }));
        if(singleImage) { // if single image, we're done 
            return {id: photoResults[0].post_id};
        } else { // if multiple images do a multi-photo post
            const response = await this.axios.post(`/${this.pageId}/feed`, {
                access_token: accessToken || this.pageAccessToken,
                message,
                attached_media: photoResults.map(photo => ({media_fbid: photo.id}))
            });
            return response.data;
        }
    }

    async postComment({postId, message, image, accessToken}) {
        const formData = new FormData();
        formData.append('access_token', accessToken || this.pageAccessToken);
        if(message) {
            formData.append('message', message);
        }
        if(image?.data) {
            formData.append('source', image.data, {
                filename: image.file?.name,
                contentType: image.file?.mimetype,
                knownLength: image.file?.size
            });
        }
        const response = await this.axios.post(`/${postId}/comments`, formData, {
            headers: formData.getHeaders()
        });
        return response.data;
    }
}
