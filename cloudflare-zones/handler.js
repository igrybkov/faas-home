"use strict"
const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);

module.exports = async (context, callback) => {
    const email = await readFile('/var/openfaas/secrets/cloudflare-email', 'utf8');
    const apiKey = await readFile('/var/openfaas/secrets/cloudflare-api-key', 'utf8');

    const cf = require('cloudflare')({
        email: email,
        key: apiKey,
    });

    return { zones: (await cf.zones.browse()).result };
}
