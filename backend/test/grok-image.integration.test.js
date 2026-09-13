'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const BACKEND_DIR = path.resolve(__dirname, '..');
const TINY_PNG_B64 = Buffer.from('image').toString('base64');

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

async function startBackend(t, env = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-grok-image-'));
  const portProbe = http.createServer();
  const backendPort = await listen(portProbe);
  await close(portProbe);

  const child = spawn(process.execPath, ['server.js'], {
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

test('Grok 文生图请求 Host 时强制 b64_json，不走 url 下载', async t => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    upstreamRequests.push({ path: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const { backendUrl, getOutput } = await startBackend(t);
  const createResponse = await fetch(`${backendUrl}/api/nova/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      protocol: 'grok',
      mode: 'text-to-image',
      prompt: 'draw a cat',
      model: 'grok-imagine-image-quality',
      parallelCount: 1,
      outputSize: '2K',
      aspectRatio: '1:1',
      images: [],
    }),
  });
  assert.equal(createResponse.status, 202);
  const { taskId } = await createResponse.json();
  const task = await waitForTask(backendUrl, taskId);

  assert.equal(task.status, 'completed', getOutput());
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].path, '/v1/images/generations');
  assert.equal(upstreamRequests[0].body.response_format, 'b64_json');
  assert.equal(upstreamRequests[0].body.model, 'grok-imagine-image-quality');
  assert.notEqual(upstreamRequests[0].body.response_format, 'url');
});

test('Grok 图生图同样强制 b64_json', async t => {
  const upstreamRequests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    upstreamRequests.push({ path: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }));
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const { backendUrl, getOutput } = await startBackend(t);
  const createResponse = await fetch(`${backendUrl}/api/nova/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      protocol: 'grok',
      mode: 'image-to-image',
      prompt: 'edit the cat',
      model: 'grok-imagine-image-quality',
      parallelCount: 1,
      outputSize: '2K',
      aspectRatio: '1:1',
      images: [{ data: TINY_PNG_B64, mimeType: 'image/png' }],
    }),
  });
  assert.equal(createResponse.status, 202);
  const { taskId } = await createResponse.json();
  const task = await waitForTask(backendUrl, taskId);

  assert.equal(task.status, 'completed', getOutput());
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].path, '/v1/images/edits');
  assert.equal(upstreamRequests[0].body.response_format, 'b64_json');
});
