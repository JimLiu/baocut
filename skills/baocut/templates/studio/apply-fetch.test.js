const test = require('node:test');
const assert = require('node:assert');
const { fetchApply, RETRY_DELAYS_MS } = require('./apply-fetch.js');

const response = (status, body) => ({ ok: status < 300, status, json: async () => body });

test('fetchApply：网络层抛错先重试，重试落地后返回应答且不再报错', async () => {
  const calls = [];
  const slept = [];
  const deps = {
    fetch: async (url, init) => {
      calls.push([url, init.method]);
      if (calls.length === 1) throw new TypeError('Failed to fetch');
      return response(200, { ok: true, rev: 7 });
    },
    sleep: async (ms) => { slept.push(ms); },
  };
  const result = await fetchApply('__bcut/transcript/apply', { method: 'POST' }, deps);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(slept, [RETRY_DELAYS_MS[0]]);
});

test('fetchApply：服务端有状态码就是最终答复（409/413 都不重发）', async () => {
  for (const status of [409, 413, 500]) {
    let calls = 0;
    const deps = { fetch: async () => { calls += 1; return response(status, { ok: false }); }, sleep: async () => {} };
    const result = await fetchApply('__bcut/timeline/apply', { method: 'POST' }, deps);
    assert.strictEqual(result.status, status);
    assert.strictEqual(calls, 1, 'HTTP ' + status + ' 不该重试');
  }
});

test('fetchApply：重试预算耗尽后抛出最后一个错误', async () => {
  let calls = 0;
  const slept = [];
  const deps = {
    fetch: async () => { calls += 1; throw new TypeError('Load failed #' + calls); },
    sleep: async (ms) => { slept.push(ms); },
  };
  await assert.rejects(
    () => fetchApply('__bcut/transcript/apply', { method: 'POST' }, deps),
    (error) => error.message === 'Load failed #' + (RETRY_DELAYS_MS.length + 1)
  );
  assert.strictEqual(calls, RETRY_DELAYS_MS.length + 1);
  assert.deepStrictEqual(slept, [...RETRY_DELAYS_MS]);
});
