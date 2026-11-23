'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const BACKEND_DIR = path.resolve(__dirname, '..');
const images = require('./gemini-image-fixtures.json');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(resolve));
}

async function waitFor(predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw lastError || new Error('Timed out waiting for condition');
}

async function stopBackend(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('exit', resolve));
  }
}

async function startBackend(t, env = {}, nodeArgs = []) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-gemini-image-'));
  const portProbe = http.createServer();
  const backendPort = await listen(portProbe);
  await close(portProbe);

  const child = spawn(process.execPath, [...nodeArgs, process.env.NOVA_TEST_SERVER_ENTRY || 'server.js'], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(backendPort),
      NOVA_TASK_DB: path.join(tempDir, 'tasks.sqlite'),
      NOVA_IMAGE_DIR: path.join(tempDir, 'images'),
      SUB2API_GATEWAY_URL: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendOutput = '';
  child.stdout.on('data', chunk => { backendOutput += chunk; });
  child.stderr.on('data', chunk => { backendOutput += chunk; });

  t.after(async () => {
    await stopBackend(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Backend exited early:\n${backendOutput}`);
    const response = await fetch(`${backendUrl}/api/nova/queue-status`);
    return response.ok;
  });

  return { backendUrl, getOutput: () => backendOutput };
}

async function waitForTask(backendUrl, taskId) {
  return waitFor(async () => {
    const response = await fetch(`${backendUrl}/api/nova/tasks/${taskId}`);
    const value = await response.json();
    return ['completed', 'failed'].includes(value.status) ? value : null;
  });
}

test('真实Nova Gemini任务消费多种载荷并写盘；空值/拒绝/私网引用保留失败', async t => {
  const candidate = parts => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
  let fixture;
  let upstreamCalls = 0;
  let remoteCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/remote-image') { remoteCalls++; res.writeHead(200); res.end(Buffer.from(images.png, 'base64')); return; }
    upstreamCalls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
    res.writeHead(fixture.httpStatus || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(fixture.payload));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));
  const { backendUrl, getOutput } = await startBackend(t);
  const cases = [
    { name: 'wrapped png', type: 'png', payload: { response: candidate([{ inlineData: { mimeType: 'image/png', data: images.png } }]) } },
    { name: 'file snake jpeg', type: 'jpeg', payload: candidate([{ file_data: { mime_type: 'image/jpeg', file_uri: 'data:image/jpeg;base64,' + images.jpeg } }]) },
    { name: 'inline webp', type: 'webp', payload: candidate([{ inline_data: { mime_type: 'image/webp', data: images.webp } }]) },
    { name: 'second candidate no finish', type: 'png', payload: { candidates: [{ content: { parts: [] } }, { content: { parts: [{ inlineData: { data: images.png } }] } }] } },
    { name: 'first image then rejected candidate', type: 'png', payload: { candidates: [...candidate([{ inlineData: { data: images.png } }]).candidates, { finishReason: 'IMAGE_SAFETY' }] } },
    { name: 'first image then invalid part', type: 'png', payload: candidate([{ inlineData: { data: images.png } }, { inlineData: { data: 'bad' } }]) },
    { name: 'unpadded webp', type: 'webp', payload: candidate([{ inlineData: { data: images.webp.replace(/=+$/, '') } }]) },
    { name: 'text only', payload: candidate([{ text: 'refused' }]) },
    { name: 'safety', payload: { promptFeedback: { blockReason: 'SAFETY' }, ...candidate([{ inlineData: { data: images.png } }]) } },
    { name: 'remote file', payload: candidate([{ fileData: { fileUri: `http://127.0.0.1:${upstreamPort}/remote-image` } }]) },
    { name: 'model404', httpStatus: 404, payload: { error: { message: 'group does not support model' } } },
  ];
  for (fixture of cases) {
    const before = upstreamCalls;
    const createResponse = await fetch(`${backendUrl}/api/nova/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'test-key', baseUrl: `http://127.0.0.1:${upstreamPort}`, protocol: 'google', mode: 'text-to-image', prompt: 'draw', model: 'gemini-3.1-flash-image-preview', parallelCount: 1, outputSize: '2K', aspectRatio: '1:1', images: [] }),
    });
    assert.equal(createResponse.status, 202, getOutput());
    const { taskId } = await createResponse.json();
    const task = await waitForTask(backendUrl, taskId);
    assert.equal(task.status, fixture.type ? 'completed' : 'failed', fixture.name + '\n' + getOutput());
    assert.equal(upstreamCalls - before, 1, '不重试生成请求');
    const imageResponse = await fetch(`${backendUrl}/api/nova/images/${taskId}/0`);
    if (fixture.type) {
      assert.equal(imageResponse.status, 200);
      assert.equal(imageResponse.headers.get('content-type'), `image/${fixture.type}`);
      assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(images[fixture.type], 'base64'));
    } else {
      assert.equal(imageResponse.status, 404);
    }
  }
  assert.equal(remoteCalls, 0, '不下载私网图片引用');
});

test('Gemini 真实异步任务解析公网引用、落盘或记录固定失败类别', async t => {
  const candidate = parts => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
  let fixture;
  const seen = [];
  let generationCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    if (req.method === 'GET') {
      seen.push(req.headers);
      if (req.url === '/redirect') { res.writeHead(302, { location: '/remote-image' }); res.end(); return; }
      if (req.url === '/bad-image?signed=do-not-log') { res.writeHead(200, { 'content-type': 'image/png' }); res.end('<html>not image</html>'); return; }
      assert.equal(req.url, '/remote-image');
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(images.png, 'base64'));
      return;
    }
    generationCalls++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.headers['x-goog-api-key'], 'test-key');
    assert.deepEqual(body.contents[0].parts, [{ text: 'draw' }, { inlineData: { data: images.png, mimeType: 'image/png' } }]);
    assert.deepEqual(body.generationConfig, {
      temperature: 0.7, responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K', aspectRatio: '16:9' },
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixture.payload));
  });
  const port = await listen(upstream);
  t.after(() => close(upstream));
  const { backendUrl, getOutput } = await startBackend(t, {}, ['--require', path.join(__dirname, 'fixtures/gemini-public-test-transport.cjs')]);
  const remote = route => ({ file_data: { mime_type: 'image/png', file_uri: `http://nova-fixture.example:${port}${route}` } });
  for (fixture of [
    { success: true, payload: candidate([remote('/remote-image')]) },
    { success: true, payload: candidate([remote('/redirect')]) },
    { success: true, payload: candidate([remote('/bad-image?signed=do-not-log'), { inlineData: { data: images.png } }]) },
    { success: false, category: 'CONTENT_INVALID', payload: candidate([remote('/bad-image?signed=do-not-log')]) },
    { success: false, category: 'ADDRESS_BLOCKED', payload: candidate([{ fileData: { fileUri: 'http://127.0.0.1/private?signed=do-not-log' } }]) },
  ]) {
    const before = generationCalls;
    const createResponse = await fetch(`${backendUrl}/api/nova/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, protocol: 'google', mode: 'image-to-image',
        prompt: 'draw', model: 'gemini-3.1-flash-image-preview', parallelCount: 1, temperature: 0.7,
        outputSize: '2K', aspectRatio: '16:9', images: [{ data: images.png, mimeType: 'image/png' }],
      }),
    });
    assert.equal(createResponse.status, 202, getOutput());
    const { taskId } = await createResponse.json();
    const task = await waitForTask(backendUrl, taskId);
    assert.equal(task.status, fixture.success ? 'completed' : 'failed', JSON.stringify(task) + getOutput());
    assert.equal(generationCalls - before, 1, '不重复收费生成请求');
    const imageResponse = await fetch(`${backendUrl}/api/nova/images/${taskId}/0`);
    if (fixture.success) {
      assert.equal(imageResponse.status, 200);
      assert.equal(imageResponse.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from(images.png, 'base64'));
      assert.equal(JSON.stringify(task).includes('nova-fixture.example'), false, '任务只交付本站图片引用');
    } else {
      assert.equal(imageResponse.status, 404);
      assert.equal(JSON.stringify(task).includes(fixture.category), true);
    }
  }
  for (const headers of seen) {
    for (const header of ['x-goog-api-key', 'authorization', 'cookie', 'proxy-authorization']) assert.equal(headers[header], undefined);
  }
  assert.match(getOutput(), /stage=geminiRemoteImage/);
  assert.equal(getOutput().includes('do-not-log'), false);
  assert.equal(getOutput().includes('nova-fixture.example'), false);
});
