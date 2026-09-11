'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const BACKEND_DIR = path.resolve(__dirname, '..');
const TEST_PASSWORD = 'test-secret';

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

async function waitFor(predicate, timeoutMs = 15000) {
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

async function jsonRequest(baseUrl, method, pathname, { password, headerPassword, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (headerPassword != null && headerPassword !== '') {
    headers['x-prompt-gallery-password'] = headerPassword;
  }
  const payload = body ? { ...body } : {};
  if (password != null) payload.password = password;
  const hasBody = method !== 'GET';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function readStoredPrompts(promptsPath) {
  return JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
}

async function startGalleryServer(t, { password, prompts } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-prompt-gallery-'));
  const promptsPath = path.join(tempDir, 'prompts.json');
  fs.writeFileSync(promptsPath, `${JSON.stringify(prompts || [], null, 2)}\n`, 'utf8');

  const envFilePath = path.join(tempDir, '.env');
  const envLines = [`NOVA_PROMPTS_PATH=${promptsPath.replace(/\\/g, '/')}`];
  if (password) envLines.push(`PROMPT_GALLERY_PASSWORD=${password}`);
  fs.writeFileSync(envFilePath, `${envLines.join('\n')}\n`, 'utf8');

  const portProbe = http.createServer();
  const backendPort = await listen(portProbe);
  await close(portProbe);

  const env = { ...process.env };
  delete env.PROMPT_GALLERY_PASSWORD;
  env.NODE_ENV = 'production';
  env.HOSTNAME = '127.0.0.1';
  env.PORT = String(backendPort);
  env.NOVA_TASK_DB = path.join(tempDir, 'tasks.sqlite');
  env.NOVA_IMAGE_DIR = path.join(tempDir, 'images');
  env.NOVA_PROMPTS_PATH = promptsPath;
  env.NOVA_ENV_FILE = envFilePath;
  env.SUB2API_GATEWAY_URL = '';
  if (password) env.PROMPT_GALLERY_PASSWORD = password;

  const child = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let backendOutput = '';
  child.stdout.on('data', chunk => { backendOutput += chunk; });
  child.stderr.on('data', chunk => { backendOutput += chunk; });

  t.after(async () => {
    await stopBackend(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${backendPort}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Backend exited early:\n${backendOutput}`);
    const response = await fetch(`${baseUrl}/api/nova/prompts`);
    return response.ok;
  });

  return { baseUrl, promptsPath, output: () => backendOutput };
}

test('PROMPT_GALLERY_PASSWORD 未配置时写入一律 403', async t => {
  const { baseUrl, promptsPath } = await startGalleryServer(t, {
    prompts: [{ title: '原有模板', content: '一只猫', type: 1 }],
  });

  const noPassword = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    body: { title: '新模板', content: '一只狗', type: 1 },
  });
  assert.equal(noPassword.status, 403);

  const withBodyPassword = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    password: TEST_PASSWORD,
    body: { title: '新模板', content: '一只狗', type: 1 },
  });
  assert.equal(withBodyPassword.status, 403);

  const stored = readStoredPrompts(promptsPath);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].title, '原有模板');
  assert.equal(stored[0].id, undefined);
});

test('无密码 403、错密码 403，正确密码 POST 后 GET 能读到', async t => {
  const { baseUrl, promptsPath } = await startGalleryServer(t, {
    password: TEST_PASSWORD,
    prompts: [{ title: '去水印', content: '去掉水印', type: 2 }],
  });

  const listedBefore = await jsonRequest(baseUrl, 'GET', '/api/nova/prompts');
  assert.equal(listedBefore.status, 200);
  assert.equal(listedBefore.data.length, 1);
  assert.equal(listedBefore.data[0].source, 'local');
  assert.match(String(listedBefore.data[0].id), /^local-/);
  const existingId = listedBefore.data[0].id;

  const mtimeBefore = fs.statSync(promptsPath).mtimeMs;
  await new Promise(resolve => setTimeout(resolve, 20));
  const listedAgain = await jsonRequest(baseUrl, 'GET', '/api/nova/prompts');
  assert.equal(listedAgain.data[0].id, existingId);
  assert.equal(fs.statSync(promptsPath).mtimeMs, mtimeBefore);

  const noPassword = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    body: { title: '本站新词', content: '生成一张中文海报', type: 1 },
  });
  assert.equal(noPassword.status, 403);

  const wrongPassword = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    password: 'wrong-password',
    body: { title: '本站新词', content: '生成一张中文海报', type: 1 },
  });
  assert.equal(wrongPassword.status, 403);

  const created = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    headerPassword: TEST_PASSWORD,
    body: { title: '本站新词', content: '生成一张中文海报', type: 1 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.title, '本站新词');
  assert.equal(created.data.type, 1);
  assert.equal(created.data.source, 'local');
  assert.match(String(created.data.id), /^local-/);

  const listed = await jsonRequest(baseUrl, 'GET', '/api/nova/prompts');
  assert.equal(listed.status, 200);
  assert.equal(listed.data.length, 2);
  assert.equal(listed.data[0].title, '本站新词');
  assert.ok(listed.data.some(item => item.title === '去水印'));

  const stored = readStoredPrompts(promptsPath);
  assert.equal(stored.length, 2);
  assert.equal(stored[0].title, '本站新词');
  assert.equal(stored[0].id, created.data.id);
  assert.equal(stored[0].source, undefined);
  assert.ok(stored.every(item => item.id && item.title && item.content && (item.type === 1 || item.type === 2)));
  assert.ok(stored.every(item => !('source' in item)));
});

test('不能改 source=github 的假条目，PUT/DELETE 只动本站 json', async t => {
  const { baseUrl, promptsPath } = await startGalleryServer(t, {
    password: TEST_PASSWORD,
    prompts: [{ title: '可编辑模板', content: '原正文', type: 1 }],
  });

  const listed = await jsonRequest(baseUrl, 'GET', '/api/nova/prompts');
  const localId = listed.data[0].id;

  const postGithub = await jsonRequest(baseUrl, 'POST', '/api/nova/prompts', {
    password: TEST_PASSWORD,
    body: {
      title: 'GitHub 词',
      content: '不该写入',
      type: 1,
      source: 'github',
    },
  });
  assert.equal(postGithub.status, 403);

  const putGithubId = await jsonRequest(baseUrl, 'PUT', '/api/nova/prompts/github-fake-id', {
    password: TEST_PASSWORD,
    body: { title: '改远程', content: '不该写入', type: 1 },
  });
  assert.equal(putGithubId.status, 404);

  const patchGithubId = await jsonRequest(baseUrl, 'PATCH', '/api/nova/prompts/nanobanana-1', {
    headerPassword: TEST_PASSWORD,
    body: { title: '改远程', content: '不该写入', type: 2 },
  });
  assert.equal(patchGithubId.status, 404);

  const deleteGithubId = await jsonRequest(baseUrl, 'DELETE', '/api/nova/prompts/github-fake-id', {
    password: TEST_PASSWORD,
  });
  assert.equal(deleteGithubId.status, 404);

  const putLocalAsGithub = await jsonRequest(baseUrl, 'PUT', `/api/nova/prompts/${encodeURIComponent(localId)}`, {
    password: TEST_PASSWORD,
    body: { title: '仍想改成远程', content: '不该写入', type: 1, source: 'github' },
  });
  assert.equal(putLocalAsGithub.status, 403);

  const storedBlocked = readStoredPrompts(promptsPath);
  assert.equal(storedBlocked.length, 1);
  assert.equal(storedBlocked[0].title, '可编辑模板');
  assert.equal(storedBlocked[0].content, '原正文');

  const updated = await jsonRequest(baseUrl, 'PUT', `/api/nova/prompts/${encodeURIComponent(localId)}`, {
    password: TEST_PASSWORD,
    body: { title: '已更新模板', content: '新正文', type: 2 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.title, '已更新模板');
  assert.equal(updated.data.type, 2);
  assert.equal(updated.data.id, localId);

  const deleted = await jsonRequest(baseUrl, 'DELETE', `/api/nova/prompts/${encodeURIComponent(localId)}`, {
    headerPassword: TEST_PASSWORD,
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.ok, true);

  const listedAfter = await jsonRequest(baseUrl, 'GET', '/api/nova/prompts');
  assert.equal(listedAfter.data.length, 0);
  assert.equal(readStoredPrompts(promptsPath).length, 0);
});
