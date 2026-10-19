'use strict';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function fail(message) { throw new Error(`Gemini 图片响应：${message}`); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

// 仅接受已知字段，不递归寻找任意字符串，也不下载上游返回的 URL。
function mergedField(items, names) {
  let result = '';
  for (const item of items) {
    if (!object(item)) fail('图片字段格式无效');
    for (const name of names) {
      const value = item[name];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string') fail('图片字段格式无效');
      const normalized = name === 'mimeType' || name === 'mime_type' ? value.trim().toLowerCase() : value;
      if (result && result !== normalized) fail('图片字段冲突');
      result = normalized;
    }
  }
  return result;
}

function decodeImage(encoded, declaredMime) {
  if (typeof encoded !== 'string' || !encoded) fail('图片 Base64 为空');
  let mime = declaredMime;
  if (encoded.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(encoded);
    if (!match) fail('图片 data URI 无效');
    if (mime && mime !== match[1]) fail('图片 MIME 字段冲突');
    mime = match[1];
    encoded = match[2];
  }
  if (mime && !MIMES.has(mime)) fail('图片 MIME 不受支持');
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096) fail('图片大小超出限制');
  const compact = encoded.replace(/[\r\n]/g, '');
  if (compact.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(compact) || /=/.test(compact.slice(0, -2)) || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact.slice(-2)) || (compact.includes('=') && compact.length % 4 !== 0)) fail('图片 Base64 无效');
  const buffer = Buffer.from(compact, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES || buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) fail('图片 Base64 无效或超限');
  // 格式与完整边界检查；不是通用图片解码器，不接受 SVG/HTML 或任意二进制。
  let actual = '';
  if (buffer.length >= 45 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) actual = 'image/png';
  else if (buffer.length >= 16 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff &&
      buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9) actual = 'image/jpeg';
  else if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' &&
      buffer.readUInt32LE(4) + 8 === buffer.length && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16))) actual = 'image/webp';
  if (!actual) fail('图片内容无效或不完整');
  if (mime && actual !== mime) fail('图片 MIME 与内容不符');
  return { data: buffer.toString('base64'), mimeType: actual };
}

function extractGeminiImagePayload(input) {
  let layer = input;
  const candidates = [];
  for (let depth = 0; ; depth++) {
    if (!object(layer)) fail('JSON 结构无效');
    if (layer.error != null) fail('上游返回错误信封');
    for (const feedback of [layer.promptFeedback, layer.prompt_feedback]) {
      for (const reason of [feedback?.blockReason, feedback?.block_reason]) {
        if (reason && !['BLOCK_REASON_UNSPECIFIED', 'BLOCKED_REASON_UNSPECIFIED'].includes(reason)) fail('请求被安全策略拒绝');
      }
    }
    if (layer.candidates != null && !Array.isArray(layer.candidates)) fail('候选内容格式无效');
    candidates.push(...(layer.candidates || []));
    if (layer.response == null) break;
    if (depth >= 2) fail('包装层级超出限制');
    layer = layer.response;
  }
  let unavailable;
  for (const candidate of candidates) {
    try {
      if (!object(candidate)) fail('候选内容格式无效');
      for (const reason of [candidate.finishReason, candidate.finish_reason]) {
        if (reason && reason !== 'STOP') fail(reason === 'NO_IMAGE' ? '上游明确未生成图片' : '生成未正常完成或被安全策略拒绝');
      }
      const parts = candidate.content?.parts;
      if (parts != null && !Array.isArray(parts)) fail('图片 parts 格式无效');
      for (const part of parts || []) {
        if (!object(part) || part.thought === true) continue;
        try {
          const inline = [part.inlineData, part.inline_data].filter(value => value != null);
          const files = [part.fileData, part.file_data].filter(value => value != null);
          if (!inline.length && !files.length) continue;
          if (inline.length && files.length) fail('内嵌与引用图片冲突');
          const fields = inline.length ? inline : files;
          const mime = mergedField(fields, ['mimeType', 'mime_type']);
          const encoded = mergedField(fields, inline.length ? ['data'] : ['fileUri', 'file_uri']);
          if (files.length && !encoded.startsWith('data:')) fail('远程图片引用不受支持，请上游返回内嵌图片');
          // 单图任务交付首个可用结果；不让后续未交付候选覆盖已有结果。
          return decodeImage(encoded, mime);
        } catch (error) {
          unavailable = error;
        }
      }
    } catch (error) {
      unavailable = error;
    }
  }
  if (unavailable) throw unavailable;
  fail('响应中无图片数据');
}

async function readGeminiResponse(response) {
  if (!response.body) fail('响应为空');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('响应大小超出限制'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = { extractGeminiImagePayload, readGeminiResponse };
