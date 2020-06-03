'use strict';
const crypto = require('crypto');
const pug = require('pug');
const Cookies = require('cookies');
const util = require('./handler-util');
const Post = require('./post');
const moment = require('moment-timezone');

const trackingIdKey = 'tracking_id';

const oneTimeTokenMap = new Map(); //キーをユーザー名、値をトークンとする連想配列

function handle(req, res) {
  const cookies = new Cookies(req, res);
  const trackingId = addTrackingCookie(cookies, req.user);

  switch (req.method) {
    case 'GET':
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      Post.findAll({ order: [['id', 'DESC']] }).then((posts) => {
        posts.forEach((post) => {
          post.content = post.content.replace(/\+/g, ' ');
          post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
        });
        const oneTimeToken = crypto.randomBytes(8).toString('hex');
        oneTimeTokenMap.set(req.user, oneTimeToken);
        res.end(pug.renderFile('./views/posts.pug', {
          posts: posts,
          user: req.user,
          oneTimeToken: oneTimeToken
        }));
        console.info(
          `閲覧されました: user: ${req.user}, ` +
          `トラッキングID: ${trackingId}, ` +
          `remoteAddress: ${req.connection.remoteAddress}, ` +
          `ユーザーエージェント: ${req.headers['user-agent']}`
        );
      });
      break;
    case 'POST':
      let body = '';
      req.on('data', (chunk) => {
        body = body + chunk;
      }).on('end', () => {
        const decoded = decodeURIComponent(body);
        const dataArray = decoded.split('&');
        const content = dataArray[0] ? dataArray[0].split('content=')[1] : '';
        const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
        if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
          console.info('投稿されました: ' + content);
          Post.create({
            content: content,
            trackingCookie: trackingId,
            postedBy: req.user
          }).then(() => {
            oneTimeTokenMap.delete(req.user);
            handleRedirectPosts(req, res);
          });
        } else {
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        const dataArray = decoded.split('&');
        const id = dataArray[0] ? dataArray[0].split('id=')[1] : '';
        const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
        if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
          Post.findById(id).then((post) => { // sequalizeのバージョンが古いため、findByPk関数が使えなかった。
            if (req.user === post.postedBy || req.user === 'admin') {
              post.destroy().then(() => {
                console.info(
                  `削除されました: user: ${req.user}, ` +
                  `remoteAddress: ${req.connection.remoteAddress}, ` +
                  `userAgent: ${req.headers['user-agent']} `
                );
                handleRedirectPosts(req, res);
              });
            }
          });
        } else {
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

/**
 * Cookieに含まれているトラッキングIDに異常がなければその値を返し、
 * 存在しない場合や異常なものである場合には、再度作成しCookieに付与してその値を返す
 * @param {Cookies} cookies
 * @param {String} userName
 * @return {String} トラッキングID
 */
function addTrackingCookie(cookies, userName) {
  const requestedTrackingId = cookies.get(trackingIdKey);
  if (isValidTrackingId(requestedTrackingId, userName)) {
    return requestedTrackingId;
  } else {
    const originalId = parseInt(crypto.randomBytes(8).toString('hex'), 16);
    const tomorrow = new Date(Date.now() + (1000 * 60 * 60 * 24));
    const trackingId = `${originalId}_${createValidHash(originalId, userName)}`;
    cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
    return trackingId;
  }
}

function isValidTrackingId(trackingId, userName) {
  if (!trackingId) {
    return false;
  }
  const splitted = trackingId.split('_');
  const originalId = splitted[0];
  const requestedHash = splitted[1];
  return createValidHash(originalId, userName) === requestedHash;
}

const secretKey =
  '50c0582db1ca6a4de14c6a34159d4740e0be6f08c9a3ccb3c5ef6e44ea42f9' +
  '9ae474429d229530bf6026c4a292f881235093b5892cea597032c2220a6405' +
  '1820e59f2631e4605b9943840938627e9b0ca47d497bb94ee3a81a092fc823' +
  '6f347486c0dbf51797eeb8f68fec4b5fab5a898ee2dc3464d2474aebaba15e' +
  '5c4b0facbb04b875b4407d9586a9fab069bc0d030818f8d6fccb4f37912a39' +
  'b7efeba9aa350ecfaa9c09af1693388ea80a9f6244d88c2d04ddb4a78e6a48' +
  'a84161ee4058492e27fea5f64088ba73285cdb68ad46642158fbdc18d3154b' +
  'ce89a61fc7d2f6bd678d8df0611bf6e1755c67cafa1f8d8d47a3a24615a9e3' +
  '82fd3d0c0b426e63';

function createValidHash(originalId, userName) {
  const sha1sum = crypto.createHash('sha1');
  sha1sum.update(originalId + userName + secretKey);
  return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    'Location': '/posts'
  });
  res.end();
}

module.exports = {
  handle,
  handleDelete
};