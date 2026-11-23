'use strict';

// 测试进程专用：公网 DNS 契约保持真实，拨号边界改接本地合成上游。
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const http = require('node:http');
const originalLookup = dns.lookup.bind(dns);
const originalRequest = http.request;
dns.lookup = (host, options) => host === 'nova-fixture.example'
  ? Promise.resolve([{ address: '93.184.216.34', family: 4 }])
  : originalLookup(host, options);
http.request = function request(options, callback) {
  if (options.hostname !== 'nova-fixture.example') return originalRequest(options, callback);
  return originalRequest({
    ...options,
    lookup(host, lookupOptions, cb) {
      options.lookup(host, lookupOptions, (error, address, family) => {
        assert.equal(address, '93.184.216.34');
        assert.equal(family, 4);
        cb(error, '127.0.0.1', 4);
      });
    },
  }, callback);
};
