/* 原型端点表驱动试用表单与代码片段。v3 后端合同由 runtime-core/services/model-api*.test.ts 验证；
   此处验证原型每个字段确实进入正确请求位置，不引用已归档的 v2 内核夹具。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./model-openai-api.js');

test('每条推理端点的表单完整覆盖有效字段，忽略字段不进入请求', () => {
  const endpoints = A.ENDPOINTS.filter(e => e.cap);
  assert.deepEqual(endpoints.map(e => [e.method, e.path]), [
    ['POST', '/audio/transcriptions'], ['POST', '/audio/speech'], ['POST', '/images/generations'],
  ]);
  for (const ep of endpoints) {
    assert.equal(new Set(ep.params.map(p => p.name)).size, ep.params.length, ep.id);
    const groups = A.formGroups(ep);
    assert.deepEqual([...groups.main, ...groups.more].map(p => p.name).sort(), ep.params.filter(p => !p.ignored).map(p => p.name).sort());
    const values = Object.fromEntries(ep.params.map(p => [p.name, p.kind === 'file' ? {name: 'fixture.wav'} : p.kind === 'multi' ? ['word'] : p.kind === 'int' ? 7 : `${p.name}-fixture`]));
    const sent = A.sentFields(ep, values);
    assert.deepEqual(sent.map(([p]) => p.name), ep.params.filter(p => !p.ignored && p.loc !== 'path').map(p => p.name));
    assert.ok(ep.params.every(p => p.loc === (ep.body === 'application/json' ? 'json' : 'form')));
    const curl = A.curl(ep, 'http://localhost:24320/v1', values, '');
    for (const [p] of sent) assert.ok(curl.includes(p.name), `${ep.id}: ${p.name}`);
    for (const p of ep.params.filter(p => p.ignored)) assert.ok(!curl.includes(`${p.name}-fixture`), `${ep.id}: ${p.name}`);
    for (const p of ep.params.filter(p => p.reject)) assert.ok(p.values?.length, `${ep.id}: ${p.name}`);
  }
});
