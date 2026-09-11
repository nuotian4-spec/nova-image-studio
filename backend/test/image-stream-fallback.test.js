'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldSkipImageStream,
  shouldRetryImageWithoutStream,
} = require('../image-stream-fallback');

test('gateway 已设 → skip stream', () => {
  assert.equal(
    shouldSkipImageStream({
      gatewayUrl: 'http://sub2api-image-studio-e2e:8080',
      imageStreamEnabled: true,
    }),
    true,
  );
});

test('gateway 空 + IMAGE_STREAM true → 不 skip', () => {
  assert.equal(
    shouldSkipImageStream({
      gatewayUrl: '',
      imageStreamEnabled: true,
    }),
    false,
  );
});

test('错误文案 400 Upstream request failed + streamWasUsed → retry', () => {
  assert.equal(
    shouldRetryImageWithoutStream(
      'API 请求失败: 400 Upstream request failed. Please retry later.',
      true,
    ),
    true,
  );
});

test('非 stream 失败 → 不无限 retry', () => {
  assert.equal(
    shouldRetryImageWithoutStream(
      'API 请求失败: 400 Upstream request failed. Please retry later.',
      false,
    ),
    false,
  );
});
