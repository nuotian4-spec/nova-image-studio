'use strict';

/**
 * OpenAI 文生图是否先走 stream，以及 stream 失败后是否回退非流式。
 * 父站 OpenAI 兼容中转会因 stream:true 直接 400，且错误文案不含 unsupported。
 */

const IMAGE_STREAM_UNSUPPORTED_PATTERN = /(?:(?:stream|partial_images).*(?:unsupported|not supported|unknown|unrecognized|invalid)|(?:unsupported|not supported|unknown|unrecognized|invalid).*(?:stream|partial_images)|(?:stream|partial_images).*(?:不支持|未知|无效)|(?:不支持|未知|无效).*(?:stream|partial_images))/i;

function shouldSkipImageStream({ gatewayUrl, imageStreamEnabled } = {}) {
  if (String(gatewayUrl || '').trim()) return true;
  return imageStreamEnabled === false;
}

function shouldRetryImageWithoutStream(errorMessage, streamWasUsed) {
  if (!streamWasUsed) return false;
  const message = String(errorMessage || '');
  if (!message) return false;
  if (/\b400\b/.test(message)) return true;
  if (/invalid[_\s-]?request/i.test(message)) return true;
  if (/upstream request failed/i.test(message)) return true;
  return IMAGE_STREAM_UNSUPPORTED_PATTERN.test(message);
}

module.exports = {
  shouldSkipImageStream,
  shouldRetryImageWithoutStream,
};
