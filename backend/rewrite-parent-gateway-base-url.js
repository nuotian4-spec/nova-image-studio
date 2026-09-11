'use strict';

/**
 * 把父页注入的网关 baseUrl 改写成 sidecar 内网可达地址。
 * 仅用于父站网关调用；官方上游与插件 defaultBaseUrl 不得走这里。
 */

const OFFICIAL_UPSTREAM_HOSTS = new Set([
  'api.openai.com',
  'api.x.ai',
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
]);

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function normalizeGatewayOrigin(url) {
  let normalized = normalizeBaseUrl(url);
  if (normalized.endsWith('/v1beta')) return normalized.slice(0, -7);
  if (normalized.endsWith('/v1')) return normalized.slice(0, -3);
  return normalized;
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isOfficialUpstreamBaseUrl(baseUrl) {
  const hostname = getHostname(baseUrl);
  return hostname !== '' && OFFICIAL_UPSTREAM_HOSTS.has(hostname);
}

/**
 * @param {string} baseUrl 父页或请求里的 API 基础地址
 * @param {string} envGateway SUB2API_GATEWAY_URL，空则不改写（standalone BYOK）
 * @returns {string} 规范化后的上游 origin（无尾斜杠）
 */
function rewriteParentGatewayBaseUrl(baseUrl, envGateway) {
  const normalizedOriginal = normalizeBaseUrl(baseUrl);
  const normalizedGateway = normalizeGatewayOrigin(envGateway);
  if (!normalizedGateway) return normalizedOriginal;
  if (isOfficialUpstreamBaseUrl(normalizedOriginal)) return normalizedOriginal;
  return normalizedGateway;
}

module.exports = {
  OFFICIAL_UPSTREAM_HOSTS,
  normalizeBaseUrl,
  normalizeGatewayOrigin,
  isOfficialUpstreamBaseUrl,
  rewriteParentGatewayBaseUrl,
};
