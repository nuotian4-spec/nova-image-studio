'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const test = require('node:test');
const { createGeminiImageDownloader, resolveGeminiImagePayload: resolve } = require('../gemini-remote-image');
const { geminiImageCandidates } = require('../gemini-image-response');
const images = require('./gemini-image-fixtures.json');
const candidate = parts => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
const inline = { inlineData: { mimeType: 'image/png', data: images.png } };
const remote = url => ({ fileData: { mimeType: 'image/png', fileUri: url } });
const png = Buffer.from(images.png, 'base64');

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}

test('Gemini 远程图片走真实 HTTP/TLS、地址校验和流式限额', async t => {
  const requests = [];
  let bodyClosed = false;
  function handle(req, res) {
    requests.push({ url: req.url, headers: req.headers, method: req.method, encrypted: !!req.socket.encrypted });
    const route = req.url.split('?')[0];
    if (route === '/redirect') { res.writeHead(302, { location: '/png' }); res.end(); return; }
    if (route === '/private') { res.writeHead(302, { location: 'http://127.0.0.1/private' }); res.end(); return; }
    if (route === '/mixed') { res.writeHead(302, { location: 'http://mixed.example/png' }); res.end(); return; }
    if (route === '/cycle') { res.writeHead(302, { location: '/cycle' }); res.end(); return; }
    if (route === '/bad-status') { res.writeHead(503); res.end('secret'); return; }
    if (route === '/length-big') { res.writeHead(200, { 'content-length': String(20 * 1024 * 1024 + 1) }); res.flushHeaders(); return; }
    if (route === '/chunked-big') { res.writeHead(200); res.end(Buffer.alloc(20 * 1024 * 1024 + 1)); return; }
    if (route === '/slow') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.write(png.subarray(0, 20));
      res.on('close', () => { bodyClosed = true; });
      return;
    }
    if (route === '/slow-headers') return;
    if (route === '/wrong-mime') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(png); return; }
    if (route === '/html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>secret</html>'); return; }
    if (route === '/html-no-mime') { res.writeHead(200); res.end('<html>secret</html>'); return; }
    if (route === '/truncated') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png.subarray(0, 20)); return; }
    if (route === '/broken-body') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length + 10 });
      res.write(png); setImmediate(() => res.destroy()); return;
    }
    const type = route.slice(1);
    res.writeHead(200, { 'content-type': `image/${type}` });
    res.end(Buffer.from(images[type] || images.png, 'base64'));
  }
  const server = http.createServer(handle);
  const secure = https.createServer({
    key: fs.readFileSync(path.join(__dirname, 'fixtures/gemini-remote-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures/gemini-remote-cert.pem')),
  }, handle);
  const port = await listen(server);
  const tlsPort = await listen(secure);
  t.after(async () => { await close(server); await close(secure); });

  const pins = [];
  const dnsCalls = [];
  const download = createGeminiImageDownloader({
    lookup: async host => {
      dnsCalls.push(host);
      return host === 'mixed.example'
        ? [{ address: '93.184.216.34' }, { address: '10.0.0.8' }]
        : [{ address: '93.184.216.34' }];
    },
    request(options, callback) {
      assert.equal(options.agent, false);
      assert.deepEqual(Object.keys(options.headers), ['Accept']);
      // 只在测试传输边界把已经钉住的公网地址接到受控本地服务器。
      return (options.protocol === 'https:' ? https : http).request({
        ...options,
        rejectUnauthorized: false,
        lookup(host, lookupOptions, cb) {
          options.lookup(host, lookupOptions, (error, address, family) => {
            pins.push({ host, address, family });
            cb(error, '127.0.0.1', 4);
          });
        },
      }, callback);
    },
    timeoutMs: 350,
  });
  const url = (route, protocol = 'http') => `${protocol}://nova-fixture.example:${protocol === 'https' ? tlsPort : port}${route}`;
  const expected = { data: images.png, mimeType: 'image/png' };
  await t.test('内嵌/data URI/HTTP/HTTPS 同图，保留首个可用候选', async () => {
    assert.deepEqual(await resolve(candidate([inline]), download), expected);
    assert.deepEqual(await resolve(candidate([{ file_data: { file_uri: `data:image/png;base64,${images.png}` } }]), download), expected);
    assert.deepEqual(await resolve(candidate([remote(url('/png'))]), download), expected);
    assert.deepEqual(await resolve(candidate([remote(url('/png', 'https'))]), download), expected);
    assert.deepEqual(await resolve(candidate([{ file_data: { mime_type: 'image/png', file_uri: url('/redirect') } }]), download), expected);
    for (const type of ['jpeg', 'webp']) {
      assert.deepEqual(await resolve(candidate([{ fileData: { mimeType: `image/${type}`, fileUri: url(`/${type}`) } }]), download), { data: images[type], mimeType: `image/${type}` });
    }
    const before = requests.length;
    assert.deepEqual(await resolve(candidate([inline, remote(url('/png'))]), download), expected);
    assert.equal(requests.length, before);
    assert.deepEqual(await resolve(candidate([remote(url('/html')), inline]), download), expected);
    assert.equal(requests.some(item => item.encrypted), true);
  });
  await t.test('纯结构解析不联网，冲突/拒绝不下载，错误可回退', async () => {
    const before = requests.length;
    assert.equal([...geminiImageCandidates(candidate([remote(url('/png'))]))][0].type, 'remote');
    await assert.rejects(resolve({ ...candidate([remote(url('/png'))]), promptFeedback: { blockReason: 'SAFETY' } }, download), /安全策略/);
    await assert.rejects(resolve(candidate([{ ...inline, ...remote(url('/png')) }]), download), /冲突/);
    await assert.rejects(resolve(candidate([{ fileData: { fileUri: url('/png'), file_uri: url('/jpeg') } }]), download), /冲突/);
    assert.deepEqual(await resolve(candidate([{ ...inline, ...remote(url('/png')) }, inline]), download), expected);
    assert.equal(requests.length, before);
  });
  await t.test('私网、映射地址、元数据、用户信息和混合 DNS 在拨号前拒绝', async () => {
    const before = requests.length;
    for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]', '[64:ff9b::7f00:1]', 'metadata.google.internal', 'localhost', 'mixed.example']) {
      await assert.rejects(download(`http://${host}/secret?TOKEN=secret`), error => error.code === 'GEMINI_REMOTE_ADDRESS_BLOCKED' && !error.message.includes('secret'));
    }
    for (const raw of ['http://user:secret@nova-fixture.example/png', 'ftp://nova-fixture.example/png', 'gs://bucket/file', 'not a URL']) {
      await assert.rejects(download(raw), { code: 'GEMINI_REMOTE_URL_INVALID' });
    }
    assert.equal(requests.length, before);
  });
  await t.test('重定向逐跳重验并固定跳数', async () => {
    await assert.rejects(download(url('/private')), { code: 'GEMINI_REMOTE_ADDRESS_BLOCKED' });
    await assert.rejects(download(url('/mixed')), { code: 'GEMINI_REMOTE_ADDRESS_BLOCKED' });
    const before = requests.length;
    await assert.rejects(download(url('/cycle')), { code: 'GEMINI_REMOTE_REDIRECT_LIMIT' });
    assert.equal(requests.length - before, 6);
  });
  await t.test('有无 Content-Length 超过20MiB均终止读取', async () => {
    for (const route of ['/length-big', '/chunked-big']) await assert.rejects(download(url(route)), { code: 'GEMINI_REMOTE_TOO_LARGE' });
  });
  await t.test('15秒合同的注入短预算覆盖 DNS、响应头和整个body，取消连接', async () => {
    for (const route of ['/slow', '/slow-headers']) await assert.rejects(download(url(route)), { code: 'GEMINI_REMOTE_TIME_LIMIT' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(bodyClosed, true);
    const dnsTimeout = createGeminiImageDownloader({ lookup: () => new Promise(() => {}), timeoutMs: 20 });
    await assert.rejects(dnsTimeout(url('/png')), { code: 'GEMINI_REMOTE_TIME_LIMIT' });
  });
  await t.test('非2xx、坏MIME、HTML、截断内容不产生图片', async () => {
    await assert.rejects(download(url('/bad-status')), { code: 'GEMINI_REMOTE_HTTP_STATUS' });
    await assert.rejects(download(url('/broken-body')), { code: 'GEMINI_REMOTE_TRANSPORT' });
    for (const route of ['/wrong-mime', '/html', '/html-no-mime', '/truncated']) {
      await assert.rejects(resolve(candidate([remote(url(route))]), download), error => /^GEMINI_REMOTE_(CONTENT_INVALID|MIME_INVALID)$/.test(error.code) && !error.message.includes('secret'));
    }
    await assert.rejects(resolve(candidate([{ fileData: { mimeType: 'image/jpeg', fileUri: url('/png') } }]), download), { code: 'GEMINI_REMOTE_MIME_INVALID' });
  });
  await t.test('无上游认证、Cookie或代理继承，实际钉住校验地址', async () => {
    const original = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://127.0.0.1:1';
    try { await download(url('/redirect') + '?signed=secret'); }
    finally {
      if (original === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = original;
    }
    assert.equal(pins.length > 0, true);
    assert.equal(pins.every(pin => pin.address === '93.184.216.34' && pin.family === 4), true);
    assert.equal(dnsCalls.includes('mixed.example'), true);
    for (const request of requests) {
      assert.equal(request.method, 'GET');
      for (const header of ['authorization', 'cookie', 'x-goog-api-key', 'proxy-authorization']) assert.equal(request.headers[header], undefined);
    }
  });
});
