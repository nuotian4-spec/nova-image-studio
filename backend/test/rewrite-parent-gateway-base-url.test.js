'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isOfficialUpstreamBaseUrl,
  rewriteParentGatewayBaseUrl,
} = require('../rewrite-parent-gateway-base-url');

const GATEWAY = 'http://sub2api:8080';

test('gateway 未设 → 原 URL 只做尾斜杠规范化，不改写', () => {
  assert.equal(
    rewriteParentGatewayBaseUrl('http://127.0.0.1:8080/', ''),
    'http://127.0.0.1:8080',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://pay.example.com/', undefined),
    'https://pay.example.com',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.openai.com/v1', '   '),
    'https://api.openai.com/v1',
  );
});

test('gateway 设了 + loopback 父页 → 改写成内网网关', () => {
  assert.equal(
    rewriteParentGatewayBaseUrl('http://127.0.0.1:8080/', GATEWAY),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('http://localhost:8080/', GATEWAY),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('http://[::1]:8080/', GATEWAY),
    GATEWAY,
  );
});

test('gateway 设了 + 公网父站域名 → 改写成内网网关', () => {
  assert.equal(
    rewriteParentGatewayBaseUrl('https://pay.example.com/', GATEWAY),
    GATEWAY,
  );
});

test('gateway 设了 + 官方上游 → 不改写', () => {
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.openai.com/v1', GATEWAY),
    'https://api.openai.com/v1',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.x.ai/', GATEWAY),
    'https://api.x.ai',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://generativelanguage.googleapis.com/v1beta', GATEWAY),
    'https://generativelanguage.googleapis.com/v1beta',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.anthropic.com/v1', GATEWAY),
    'https://api.anthropic.com/v1',
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://API.OPENAI.COM/v1', GATEWAY),
    'https://API.OPENAI.COM/v1',
  );
});

test('尾斜杠规范化稳定', () => {
  assert.equal(
    rewriteParentGatewayBaseUrl('http://127.0.0.1:8080///', `${GATEWAY}/`),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://pay.example.com/', `${GATEWAY}///`),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('http://127.0.0.1:8080/', `${GATEWAY}/v1/`),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('http://127.0.0.1:8080/', `${GATEWAY}/v1beta/`),
    GATEWAY,
  );
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.openai.com/v1/', ''),
    'https://api.openai.com/v1',
  );
});

test('原 baseUrl 为空且 gateway 已设 → 用网关 origin', () => {
  assert.equal(rewriteParentGatewayBaseUrl('', GATEWAY), GATEWAY);
  assert.equal(rewriteParentGatewayBaseUrl('   ', GATEWAY), GATEWAY);
});

test('官方上游识别按 hostname 精确匹配，不误伤仿冒域名', () => {
  assert.equal(isOfficialUpstreamBaseUrl('https://api.openai.com/v1'), true);
  assert.equal(isOfficialUpstreamBaseUrl('https://api.openai.com.evil.com/v1'), false);
  assert.equal(
    rewriteParentGatewayBaseUrl('https://api.openai.com.evil.com/v1', GATEWAY),
    GATEWAY,
  );
});
