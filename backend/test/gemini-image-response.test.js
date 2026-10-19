'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractGeminiImagePayload: extract, readGeminiResponse } = require('../gemini-image-response');
const images = require('./gemini-image-fixtures.json');
const candidate = parts => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] });
const inline = (type = 'png') => ({ inlineData: { mimeType: `image/${type}`, data: images[type] } });

for (const type of ['png', 'jpeg', 'webp']) {
  test(`支持 ${type} 内嵌/两层包装/fileData data URI并保留MIME`, () => {
    const expected = { data: images[type], mimeType: `image/${type}` };
    assert.deepEqual(extract(candidate([inline(type)])), expected);
    assert.deepEqual(extract({ response: { response: candidate([inline(type)]) } }), expected);
    assert.deepEqual(extract(candidate([{ file_data: { mime_type: `image/${type}`, file_uri: `data:image/${type};base64,${images[type]}` } }])), expected);
  });
}
test('遍历候选并支持snake字段，不把thought当结果', () => {
  assert.equal(extract({ candidates: [{ content: { parts: [{ text: 'first' }] } }, { content: { parts: [{ thought: true, inlineData: { data: 'bad' } }, { inline_data: { mime_type: 'image/png', data: images.png } }] } }] }).data, images.png);
});
test('空camel字段由snake补齐', () => {
  assert.equal(extract(candidate([{ inlineData: {}, inline_data: { data: images.png } }])).data, images.png);
});
const bad = {
  empty: {},
  text: candidate([{ text: 'no image' }]),
  thought: candidate([{ thought: true, ...inline() }]),
  malformedBase64: candidate([{ inlineData: { data: '###' } }]),
  textBytes: candidate([{ inlineData: { data: Buffer.from('<html>not image</html>').toString('base64') } }]),
  truncated: candidate([{ inlineData: { data: Buffer.from(images.png, 'base64').subarray(0, 20).toString('base64') } }]),
  mimeMismatch: candidate([{ inlineData: { data: images.png, mimeType: 'image/jpeg' } }]),
  mimeConflict: candidate([{ inlineData: { data: images.png, mimeType: 'image/png', mime_type: 'image/jpeg' } }]),
  conflict: candidate([{ inlineData: { data: images.png }, inline_data: { data: images.jpeg } }]),
  twoCarriers: candidate([{ ...inline(), fileData: { fileUri: 'data:image/png;base64,' + images.png } }]),
  remoteUrl: candidate([{ fileData: { fileUri: 'http://127.0.0.1/secret' } }]),
  blocked: { ...candidate([inline()]), promptFeedback: { blockReason: 'SAFETY' } },
  outerError: { error: { message: 'secret token' }, response: candidate([inline()]) },
  innerError: { ...candidate([inline()]), response: { error: 'secret token' } },
  incomplete: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [inline()] } }] },
  deep: { response: { response: { response: candidate([inline()]) } } },
  oversized: candidate([{ inlineData: { data: 'A'.repeat(28 * 1024 * 1024) } }]),
};
for (const [name, data] of Object.entries(bad)) test(`拒绝 ${name}`, () => assert.throws(() => extract(data), /Gemini 图片响应/));
test('错误不回显未知内容或URL', () => {
  assert.throws(() => extract(bad.outerError), error => !error.message.includes('secret'));
  assert.throws(() => extract(bad.remoteUrl), error => !error.message.includes('127.0.0.1'));
});
test('限制HTTP响应总字节并取消流', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readGeminiResponse({ body }), /响应大小超出限制/);
  assert.equal(cancelled, true);
});

test('首张有效图片不受后续不可用候选或图片拖累', () => {
  const good = candidate([inline()]).candidates[0];
  assert.equal(extract({ candidates: [good, { finishReason: 'IMAGE_SAFETY' }] }).data, images.png);
  assert.equal(extract(candidate([inline(), { inlineData: { data: 'bad' } }])).data, images.png);
  assert.equal(extract(candidate(Array.from({ length: 5 }, () => inline()))).data, images.png);
});
test('被拒绝候选不能交付但下一安全候选可选', () => {
  const good = candidate([inline()]).candidates[0];
  assert.equal(extract({ candidates: [{ ...good, finishReason: 'IMAGE_SAFETY' }, good] }).data, images.png);
  assert.throws(() => extract({ candidates: [{ ...good, finishReason: 'IMAGE_SAFETY' }] }), /未正常完成/);
  assert.equal(extract({ candidates: [{ content: { parts: [bad.conflict.candidates[0].content.parts[0]] } }, good] }).data, images.png);
});
test('兼容标准alphabet无padding但拒绝非法padding及pad bits', () => {
  assert.deepEqual(extract(candidate([{ inlineData: { data: images.webp.replace(/=+$/, '') } }])), { data: images.webp, mimeType: 'image/webp' });
  for (const data of ['A', 'AA=', 'AAAA=', '=AAA', 'A=AA', 'AB==', 'AAB=', 'AA-_']) {
    assert.throws(() => extract(candidate([{ inlineData: { data } }])), /Base64/);
  }
});
