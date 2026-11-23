'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const { BlockList, isIP } = require('node:net');
const { geminiImageCandidates, decodeImage, MAX_IMAGE_BYTES } = require('./gemini-image-response');

const blocked = new BlockList();
// 与父站图片下载策略一致，排除私网、元数据及特殊用途地址。
for (const range of [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.31.196.0/24',
  '192.52.193.0/24', '192.88.99.0/24', '192.168.0.0/16', '192.175.48.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/96', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/23',
  '2001:db8::/32', '2002::/16', '3fff::/20', '5f00::/16', 'fc00::/7',
  'fe80::/10', 'fec0::/10', 'ff00::/8',
]) {
  const [address, prefix] = range.split('/');
  blocked.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const CODES = new Set(['URL_INVALID', 'ADDRESS_BLOCKED', 'DNS_FAILED', 'TRANSPORT', 'TIME_LIMIT', 'TOO_LARGE', 'HTTP_STATUS', 'REDIRECT_LIMIT', 'MIME_INVALID', 'CONTENT_INVALID']);

function failure(code) {
  const error = new Error(`Gemini 远程图片解析失败：${code}`);
  error.code = `GEMINI_REMOTE_${code}`;
  error.stage = 'geminiRemoteImage';
  return error;
}

function validatedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw failure('URL_INVALID'); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !hostname) throw failure('URL_INVALID');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname === 'metadata' || hostname === 'metadata.google.internal' ||
      hostname.endsWith('.metadata.google.internal')) throw failure('ADDRESS_BLOCKED');
  return { url, hostname };
}

function validateAddress(address) {
  const family = isIP(address);
  if (!family || blocked.check(address, family === 6 ? 'ipv6' : 'ipv4')) throw failure('ADDRESS_BLOCKED');
  return { address, family };
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(failure('TIME_LIMIT'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// request/lookup 注入仅用于受控传输专项；生产始终使用独立无代理、无凭据的原生客户端。
function createGeminiImageDownloader({
  lookup = (hostname, options) => dns.lookup(hostname, options),
  request = (options, callback) => (options.protocol === 'https:' ? https : http).request(options, callback),
  timeoutMs = 15000,
} = {}) {
  async function readHop(url, hostname, address, signal) {
    return new Promise((resolve, reject) => {
      const req = request({
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
        agent: false,
        autoSelectFamily: false,
        family: address.family,
        // TLS 仍按原域名校验；真正拨号不再进行第二次 DNS 解析。
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        signal,
      }, response => {
        response.on('error', reject);
        const stop = error => { reject(error); response.destroy(); req.destroy(); };
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) { reject(failure('URL_INVALID')); return; }
          resolve({ location });
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) { stop(failure('HTTP_STATUS')); return; }
        const contentLength = response.headers['content-length'];
        if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_IMAGE_BYTES)) { stop(failure('TOO_LARGE')); return; }
        const mimeType = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (mimeType && !MIMES.has(mimeType)) { stop(failure('MIME_INVALID')); return; }
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_IMAGE_BYTES) { stop(failure('TOO_LARGE')); return; }
          chunks.push(chunk);
        });
        response.on('aborted', () => reject(failure('TRANSPORT')));
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), mimeType }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  return async function downloadGeminiImage(raw) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let current = raw;
      for (let redirects = 0; ; redirects++) {
        const { url, hostname } = validatedUrl(current);
        let addresses;
        if (isIP(hostname)) {
          addresses = [validateAddress(hostname)];
        } else {
          let resolved;
          try { resolved = await abortable(lookup(hostname, { all: true, verbatim: true }), controller.signal); }
          catch { throw failure(controller.signal.aborted ? 'TIME_LIMIT' : 'DNS_FAILED'); }
          if (!Array.isArray(resolved) || !resolved.length) throw failure('DNS_FAILED');
          addresses = resolved.map(candidate => validateAddress(candidate.address));
        }
        if (controller.signal.aborted) throw failure('TIME_LIMIT');
        let result;
        for (let index = 0; index < addresses.length; index++) {
          try { result = await readHop(url, hostname, addresses[index], controller.signal); break; }
          catch (error) {
            if (controller.signal.aborted || error?.code?.startsWith('GEMINI_REMOTE_') || index === addresses.length - 1) throw error;
          }
        }
        if (!result.location) return result;
        if (redirects >= 5) throw failure('REDIRECT_LIMIT');
        try { current = new URL(result.location, url).href; } catch { throw failure('URL_INVALID'); }
      }
    } catch (error) {
      if (controller.signal.aborted) throw failure('TIME_LIMIT');
      if (CODES.has(error?.code?.replace(/^GEMINI_REMOTE_/, ''))) throw error;
      throw failure('TRANSPORT');
    } finally {
      clearTimeout(timer);
    }
  };
}

const downloadGeminiImage = createGeminiImageDownloader();

async function resolveGeminiImagePayload(input, download = downloadGeminiImage) {
  let unavailable;
  for (const candidate of geminiImageCandidates(input)) {
    if (candidate.type === 'inline') return candidate.payload;
    try {
      const result = await download(candidate.url);
      let image;
      try { image = decodeImage(result.bytes.toString('base64'), result.mimeType); }
      catch { throw failure('CONTENT_INVALID'); }
      if (candidate.mimeType && image.mimeType !== candidate.mimeType) throw failure('MIME_INVALID');
      return image;
    } catch (error) {
      unavailable = error;
    }
  }
  throw unavailable;
}

module.exports = { createGeminiImageDownloader, resolveGeminiImagePayload };
