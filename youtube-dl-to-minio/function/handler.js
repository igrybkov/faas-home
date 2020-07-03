'use strict'

const fs = require('fs');
const fsPromises = require('fs').promises;
const promisify = require('util').promisify;
const execFile = promisify(require('child_process').execFile);
const crypto = require('crypto');
const Minio = require('minio');
const isUrl = require('is-url');
const path = require('path')

const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || fs.readFileSync('/var/openfaas/secrets/minio-access-key', 'utf8');
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || fs.readFileSync('/var/openfaas/secrets/minio-secret-key', 'utf8');
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
const YOUTUBEDL_FORMAT = process.env.YOUTUBEDL_FORMAT || 'bestvideo[ext!=webm]+bestaudio[ext!=webm]/best'
const YOUTUBEDL_OUTPUT_FORMAT = 'mp4'
const minio = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: 443,
  useSSL: true,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

const trimSlashes = (str) => str.replace(/^\/|\/$/g, '');

module.exports = async (event, context) => {
  try {
    validateRequest(event.body);
  } catch (err) {
    return context.status(400).fail({ status: 'error', message: err, metadata });
  }
  const { url, force, metadata } = event.body
  const bucket = trimSlashes(event.body.bucket);
  const dest = trimSlashes(event.body.dest);

  debug(`url: ${url}`);
  debug(`dest: ${dest}`);
  debug(`bucket: ${bucket}`);
  debug(`MINIO_ENDPOINT: ${MINIO_ENDPOINT}`);
  debug(`YOUTUBEDL_FORMAT: ${YOUTUBEDL_FORMAT}`);
  debug(`YOUTUBEDL_OUTPUT_FORMAT: ${YOUTUBEDL_OUTPUT_FORMAT}`);

  const fileName = await getFileName(url);
  debug(`fileName: ${fileName}`)
  const videoName = getVideoName(fileName);
  debug(`videoName: ${videoName}`)
  const remoteDir = trimSlashes(`${dest}/${videoName}`);
  debug(`remoteDir: ${remoteDir}`)
  const remoteFile = `${remoteDir}/${fileName}`;
  debug(`remoteFile: ${remoteFile}`)

  try {
    await minio.statObject(bucket, remoteFile);
    debug(`remote file already exists`)
    if (!force) {
      return context.status(200).succeed({ status: 'fileExists', message: "file already exists", "remoteDir": remoteDir, metadata });
    }
  } catch (err) {
    debug(`remote file does not exist`)
  }

  // const dir = crypto.createHash('sha256').update([url, remoteFile, Date.now()].join('|')).digest('hex');
  const localDir = crypto.createHash('sha256').update([url, remoteFile].join('|')).digest('hex');
  debug(`localDir: ${localDir}`);

  try {
    debug(`downloading video`);
    const resp = await execFile(
      'youtube-dl',
      [
        '-f', YOUTUBEDL_FORMAT,
        '--merge-output-format', YOUTUBEDL_OUTPUT_FORMAT,
        '--write-sub', '--all-subs',
        '-o', `${localDir}/%(title)s.%(ext)s`,
        // '--embed-subs',
        '--write-thumbnail',
        '--add-metadata',
        // '--embed-thumbnail',
        url
      ]
    );
    debug(`download done: ${resp.stdout}`);
    if (resp.stderr) {
      console.log(`STDERR: ${resp.stderr}`);
    }
  } catch (err) {
    debug(`download failed: ${err}`);
    console.error(err);
    return context.status(500).fail({ status: 'error', message: err, metadata });
  }

  try {
    const files = await fsPromises.readdir(localDir);
    debug(`files: ${files.join(', ')}`);

    for (const file of files) {
      const localFilePath = `${localDir}/${file}`
      const remoteFilePath = `${remoteDir}/${file}`
      await minio.fPutObject(bucket, remoteFilePath, localFilePath, {})
    }

  } catch (err) {
    console.error(err);
    return context.status(500).fail({ status: 'error', message: err, metadata });
  } finally {
    await fsPromises.rmdir(localDir, { recursive: true });
  }

  return context.status(200).succeed({ status: 'success', message: "file downloaded", "remoteDir": remoteDir, metadata });
}

const validateRequest = async (body) => {
  if (!body.url || !body.url.length) {
    throw new Error('url cannot be empty');
  }
  if (!isUrl(body.url)) {
    throw new Error('url is not a valid URL');
  }
  if (!body.dest || !body.dest.length) {
    throw new Error('dest: destination path cannot be empty');
  }
  if (!body.bucket || !body.bucket.length) {
    throw new Error('bucket cannot be empty');
  }
}

const getFileName = async url => {
  const { stdout: fileName } = await execFile(
    'youtube-dl',
    [
      '-f', YOUTUBEDL_FORMAT,
      '--merge-output-format', YOUTUBEDL_OUTPUT_FORMAT,
      '-o', '%(title)s.%(ext)s',
      '--get-filename',
      url
    ]
  );
  return fileName;
}

const getVideoName = (fileName) => path.parse(fileName).name;

const debug = (msg) => process.env.DEBUG && console.log(msg);
