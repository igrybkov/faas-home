"use strict"
const fs = require('fs');
const util = require('util');
const publicIp = require('public-ip');

const zoneId = process.env.CF_ZONE_ID
const subdomainToUpdate = process.env.DOMAIN_NAME

const readFile = util.promisify(fs.readFile);

module.exports = async (context, callback) => {
    const email = await readFile('/var/openfaas/secrets/cloudflare-email', 'utf8');
    const apiKey = await readFile('/var/openfaas/secrets/cloudflare-api-key', 'utf8');

    const cf = require('cloudflare')({
        email: email,
        key: apiKey,
    });

    const zoneInfo = (await cf.zones.read(zoneId)).result;
    const zoneName = zoneInfo.name;
    const recordName = `${subdomainToUpdate}.${zoneName}`;

    const existingRecord = (await cf.dnsRecords.browse(zoneId)).result.filter((record) => {
        return record.name === recordName
    }).shift();

    const existingIp = existingRecord ? existingRecord.content : null;
    const currentPublicIp = await publicIp.v4({ onlyHttps: true });

    if (currentPublicIp !== existingIp) {
        if (existingRecord) {
            existingRecord.content = currentPublicIp
            await cf.dnsRecords.edit(zoneId, existingRecord.id, existingRecord);
            console.log(`dns record ${recordName} updated to ip ${currentPublicIp}`)
            return { status: "updated" }
        } else {
            const newRecord = {
                zone_id: zoneId,
                zone_name: zoneName,
                name: recordName,
                type: 'A',
                content: currentPublicIp,
                proxiable: false,
                proxied: false,
                ttl: 120,
            };
            await cf.dnsRecords.add(zoneId, newRecord);
            console.log(`dns record ${recordName} created with ip ${currentPublicIp}`)
            return { status: "created" }
        }
    }
    return { status: "unchanged" }
}
