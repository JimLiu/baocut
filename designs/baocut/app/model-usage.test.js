/* 用量账本读法的单测 —— node --test designs/baocut/app/*.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global.window || {};
require('./model-cloud-image.js');
const U = require('./model-usage.js');

const NOW = new Date(2026, 9, 6, 15, 0, 0).getTime();
const rec = (o) => Object.assign({at: new Date(NOW - 3600000).toISOString(), providerId: 'openai', accountId: 'main', capability: 'text', modelId: 'gpt-6.1-sol',
  source: 'job', units: {}, cost: {kind: 'unknown'}, durationMs: 1000, status: 'ok'}, o);

test('估算：按标价算；没有标价的算未知；报告的金额优先；失败且没用量的不计费', () => {
  const e = U.costOf(rec({units: {inputTokens: 1e6, outputTokens: 1e5}}));
  assert.equal(e.kind, 'estimated'); assert.equal(e.currency, 'USD'); assert.ok(Math.abs(e.amount - 3.5) < 1e-9);
  assert.deepEqual(U.costOf(rec({providerId: 'elevenlabs', modelId: 'scribe_v2', units: {audioSeconds: 60}})), {kind: 'unknown'});
  assert.deepEqual(U.costOf(rec({cost: {kind: 'reported', amount: '0.42', currency: 'CNY'}, units: {inputTokens: 5}})), {kind: 'reported', amount: 0.42, currency: 'CNY'});
  assert.deepEqual(U.costOf(rec({status: 'error'})), {kind: 'none'});
  const img = U.costOf(rec({capability: 'image', modelId: 'gpt-image-2', units: {images: 3}}));
  assert.ok(Math.abs(img.amount - 0.12) < 1e-9, '生图从图像价目表读');
});

test('汇总：币种分开、不换算；未知次数单列；按 API 提供方 / 能力 / 模型 / 账号拆分', () => {
  const recs = [
    rec({units: {inputTokens: 1e6}}),
    rec({providerId: 'deepseek', modelId: 'deepseek-v4-flash', units: {inputTokens: 1e6}}),
    rec({providerId: 'agent:codex', accountId: null, capability: 'image', modelId: 'image-gen', units: {images: 1}}),
    rec({status: 'error', accountId: 'k7q2'}),
    rec({at: new Date(NOW - 40 * 86400000).toISOString(), units: {inputTokens: 1e6}}),
  ];
  const r = U.report(recs, '30d', {now: NOW});
  assert.equal(r.totals.calls, 4);
  assert.equal(r.totals.failed, 1);
  assert.deepEqual(r.totals.cost.estimated, {USD: 2.5, CNY: 2});
  assert.equal(r.totals.cost.reported, null);
  assert.equal(r.totals.cost.unknownCalls, 1);
  assert.equal(r.byDay.length, 30);
  assert.equal(r.byProvider[0].key, 'openai');
  assert.equal(r.byProvider.find((x) => x.key === 'agent:codex').costKind, 'unknown');
  assert.deepEqual(r.byAccount.map((x) => x.key).sort(), ['agent:codex#', 'deepseek#main', 'openai#k7q2', 'openai#main']);
  assert.equal(U.report(recs, 'all', {now: NOW}).totals.calls, 5);
  assert.equal(U.report(recs, '30d', {now: NOW, providerId: 'deepseek'}).totals.calls, 1);
  const mixed = U.report([rec({units: {inputTokens: 1e6}}), rec({cost: {kind: 'reported', amount: '1', currency: 'USD'}})], 'today', {now: NOW});
  assert.equal(mixed.byProvider[0].costKind, 'mixed');
  assert.deepEqual(mixed.totals.cost.reported, {USD: 1});
});

test('时段：今天从零点起，7 天含今天', () => {
  const r = U.range('today', NOW, []);
  assert.equal(new Date(r.from).getHours(), 0);
  assert.equal(U.report([], '7d', {now: NOW}).byDay.length, 7);
  assert.equal(U.report([], 'month', {now: NOW}).byDay.length, 6, '本月：10 月 1 日到 6 日');
});

test('格式：21M / 2.2K；金额带币种；分钟', () => {
  assert.equal(U.fmtCount(21000000), '21M');
  assert.equal(U.fmtCount(2200), '2.2K');
  assert.equal(U.fmtCount(950), '950');
  assert.equal(U.fmtMoney(12.345, 'USD'), '$12.35');
  assert.equal(U.fmtMoney(86.4, 'CNY'), '¥86.40');
  assert.equal(U.fmtMoney(0.001, 'USD'), '<$0.01');
  assert.equal(U.fmtMoneyMap({CNY: 1, USD: 2}), '$2.00 + ¥1.00');
  assert.equal(U.fmtMoneyMap(null), '');
  assert.equal(U.fmtMinutes(45), '45 秒');
  assert.equal(U.fmtMinutes(750), '12.5 分钟');
  assert.equal(U.fmtUnits({inputTokens: 1200000, outputTokens: 300000, images: 2}), '1.2M 入 · 300K 出 · 2 张');
});

test('演示账本：30 天、确定的、几家几种能力，有失败、有未知、有报告', () => {
  const a = U.seedRecords(NOW), b = U.seedRecords(NOW);
  assert.deepEqual(a, b);
  const r = U.report(a, '30d', {now: NOW});
  assert.ok(r.totals.calls > 100);
  assert.ok(r.totals.failed > 0);
  assert.ok(r.totals.cost.unknownCalls > 0);
  assert.ok(r.totals.cost.estimated.USD > 0 && r.totals.cost.estimated.CNY > 0);
  assert.ok(r.totals.cost.reported.CNY > 0);
  assert.deepEqual(r.byCapability.map((x) => x.key).sort(), ['image', 'text', 'transcribe', 'tts']);
  assert.ok(a.every((x) => Date.parse(x.at) <= NOW));
  assert.ok(U.report(a, 'today', {now: NOW}).totals.calls > 0);
});
