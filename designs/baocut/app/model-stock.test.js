const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./model-stock.js');

test('一句话解析是减法：筛得动的进 hard，筛不动的进 soft，剩下的才发给来源', () => {
  const intent = S.parseIntent('video', '10 秒以内的竖屏城市空镜，要 1080p，有电影感');
  assert.equal(intent.hard.maxDurationSec, 10);
  assert.equal(intent.hard.minDurationSec, null);
  assert.equal(intent.hard.orientation, 'portrait');
  assert.equal(intent.hard.minHeight, 1080);
  assert.deepEqual(intent.soft, []);
  assert.equal(intent.queries[0].includes('城市'), true);
  // 吃掉的词不许再作为关键词发出去
  for (const eaten of ['竖屏', '1080p', '以内', '10']) assert.equal(intent.queries[0].includes(eaten), false);

  const en = S.parseIntent('video', 'at least 30s cinematic sunset landscape');
  assert.equal(en.hard.minDurationSec, 30);
  assert.equal(en.hard.orientation, 'landscape');
  assert.deepEqual(en.soft, ['cinematic']);
  assert.equal(en.queries[0], 'sunset');
});

test('孤零零一个时长按上界算，区间写法两端都吃进去', () => {
  assert.deepEqual(S.durationBounds('10 秒空镜').max, 10);
  assert.equal(S.durationBounds('10 秒空镜').min, null);
  const range = S.durationBounds('5-15 秒');
  assert.equal(range.min, 5);
  assert.equal(range.max, 15);
  assert.equal(S.durationBounds('30秒以上').min, 30);
  // 「s」跟着字母时是词头不是秒
  assert.equal(S.durationBounds('4 sunsets').max, null);
});

test('音频类别词只在音频 Tab 认，视频 Tab 里它就是普通关键词', () => {
  assert.equal(S.parseIntent('audio', '轻快的背景音乐，无人声').hard.audioCategory, 'music');
  assert.equal(S.parseIntent('video', '背景音乐现场').hard.audioCategory, null);
});

test('许可判定是三值：禁止的不放行，没核对过的不升级成可以用', () => {
  assert.equal(S.evaluate('mixkit-music-free', 'online-video'), 'allowed');
  assert.equal(S.evaluate('mixkit-music-free', 'broadcast'), 'not-allowed');
  assert.equal(S.evaluate('mixkit-music-free', 'game'), 'not-allowed');
  // Openverse 索引的许可官方不保证准确，任何用途都只能是未确认
  for (const usage of S.ALL_USAGE) assert.equal(S.evaluate('cc0', usage), 'unverified');
  assert.equal(S.evaluate('没有这条许可', 'podcast'), 'unverified');
  assert.equal(S.evaluate('pexels-license', 'game'), 'unverified', '表里没写 game，不许推成允许');
});

test('缺元数据不算通过硬条件，它只能落未验证', () => {
  const missing = S.ASSETS.find((a) => a.assetId === 'demo-v-5');
  const hard = {minDurationSec: null, maxDurationSec: 10, orientation: 'portrait', minHeight: null, audioCategory: null};
  const r = S.report(missing, hard);
  assert.deepEqual(r.verified, []);
  assert.deepEqual(r.unverified.sort(), ['maxDurationSec', 'orientation']);
  assert.equal(S.passesHard(missing, hard), false);
  // 一条都不要求时，谁都通过
  assert.equal(S.passesHard(missing, {}), true);
});

test('面板五态：能搜的来源在不在，比有没有结果先判', () => {
  const video = S.capabilitiesFor('video');
  assert.equal(S.paneState(video, 'video', true, 0), 'searching');
  assert.equal(S.paneState(video, 'video', false, 3), 'results');
  assert.equal(S.paneState(video, 'video', false, 0), 'empty');
  // 两个内嵌来源都关掉，只剩站外的 Mixkit：这不是「没有搜索结果」
  const externalOnly = S.capabilitiesFor('video', {pexels: true, pixabay: true});
  assert.equal(S.paneState(externalOnly, 'video', false, 0), 'external-only');
  const nothing = S.capabilitiesFor('video', {pexels: true, pixabay: true, mixkit: true});
  assert.equal(S.paneState(nothing, 'video', false, 0), 'needs-setup');
});

test('检索：硬条件本地复筛、每个来源为什么没出结果都记下来', () => {
  const out = S.search('video', '10 秒以内的竖屏城市', {});
  assert.ok(out.hits.length > 0);
  for (const hit of out.hits) {
    assert.equal(hit.asset.spec.durationSec <= 10.05, true);
    assert.equal(S.orientationOf(hit.asset.spec.width, hit.asset.spec.height), 'portrait');
  }
  const byId = Object.fromEntries(out.providers.map((p) => [p.providerId, p]));
  assert.equal(byId.mixkit.status, 'external-only');
  assert.equal(S.outcomeLine(byId.mixkit), '只能到站点检索');
  assert.ok(byId.pexels.filteredOut > 0, '被硬条件筛掉的条数要如实记');
  assert.match(S.outcomeLine(byId.pexels), /不满足筛选条件/);
});

test('排序：验过的条件多的在前，软偏好只加分不筛人', () => {
  const out = S.search('video', '城市 cinematic', {});
  const ids = out.hits.map((h) => h.asset.assetId);
  assert.ok(ids.includes('demo-v-1'), 'cinematic 是软偏好，不该把别人筛掉');
  const scores = out.hits.map((h) => h.matchReport.score);
  assert.deepEqual(scores, scores.slice().sort((a, b) => b - a));
});

test('用途档禁止的候选不进结果，也不自动改用付费版本', () => {
  const asset = {providerId: 'mixkit', assetId: 'm1', kind: 'audio', audioCategory: 'music', title: 't', tags: [],
    origin: {}, spec: {durationSec: 60}, renditions: [{id: 'mp3', format: 'mp3', cost: 'free', license: 'mixkit-music-free'}]};
  const intent = S.parseIntent('audio', '');
  intent.usageProfile = 'broadcast';
  assert.equal(S.hit(asset, intent, 0).verdict, 'not-allowed');
  intent.usageProfile = 'podcast';
  assert.equal(S.hit(asset, intent, 0).verdict, 'allowed');

  const paidOnly = {renditions: [{id: 'p', cost: 'paid', license: 'pexels-license'}]};
  assert.equal(S.defaultRendition(paidOnly, 'free-only', 'online-video'), null);
  const plan = S.acquirePlan(paidOnly, paidOnly.renditions[0], 'online-video', 'free-only');
  assert.deepEqual(plan, {ok: false, code: 'cost_not_allowed'});
});

test('许可闸在下载之前：不允许的用途不进流水线', () => {
  const rendition = {id: 'mp3', cost: 'free', license: 'mixkit-music-free'};
  assert.equal(S.acquirePlan({}, rendition, 'broadcast', 'free-only').ok, false);
  assert.equal(S.acquirePlan({}, rendition, 'broadcast', 'free-only').code, 'license_mismatch');
  const ok = S.acquirePlan({}, rendition, 'podcast', 'free-only');
  assert.equal(ok.ok, true);
  assert.equal(ok.steps[0].k, 'resolving');
  assert.equal(ok.steps[ok.steps.length - 1].k, 'committing');
});

test('署名查不到来源时如实写未知，不猜', () => {
  assert.equal(S.attributionLine({title: '某段素材', origin: {}}), '某段素材：来源未知');
  assert.equal(S.attributionLine(null), '未知来源');
  assert.match(S.attributionLine({title: '城市夜景航拍', license: 'pexels-license',
    origin: {site: 'pexels.com', author: {name: '示例作者 A'}}}), /示例作者 A · pexels\.com · Pexels 许可/);
});

test('未知规格如实留空，不推算假精度', () => {
  const missing = S.ASSETS.find((a) => a.assetId === 'demo-v-5');
  assert.equal(S.metaLine(missing, missing.renditions[0]), '时长未知');
  const known = S.ASSETS.find((a) => a.assetId === 'demo-v-1');
  assert.equal(S.metaLine(known, known.renditions[0]), '0:16 · 1080×1920 · 约 12 MB');
});

test('Mixkit 只给站外地址，不谎称内嵌搜索；Freesound 没授权就不启用', () => {
  const mixkit = S.providerOf('mixkit');
  assert.equal(S.searchable(mixkit), false);
  assert.equal(S.externalOnly(mixkit), true);
  assert.equal(S.externalSearchUrl(mixkit, 'audio', '轻快'), 'https://mixkit.co/free-stock-music/?q=%E8%BD%BB%E5%BF%AB');
  const freesound = S.providerOf('freesound');
  assert.equal(S.searchable(freesound), false);
  assert.equal(S.statusOf(freesound), 'needs-authorization');
  assert.equal(S.outcomeLine({status: 'needs-authorization'}), '需要单独授权后才能启用');
});

test('中文一句话也要命中：整串比对会一条都搜不出来', () => {
  const out = S.search('video', '10 秒以内的竖屏城市夜景', {});
  assert.deepEqual(out.hits.map((h) => h.asset.assetId), ['demo-v-3']);
  const byId = Object.fromEntries(out.providers.map((p) => [p.providerId, p]));
  assert.equal(byId.pixabay.returned, 1);
  assert.equal(byId.pixabay.filteredOut, 1);
  assert.equal(byId.pexels.returned, 0);
  assert.ok(byId.pexels.filteredOut >= 2, '召回到了但被硬条件筛掉，要如实记成筛掉而不是没搜到');
});

test('演示数据只是夹具：每条都标演示，没有真的下载地址', () => {
  for (const asset of S.ASSETS) {
    assert.equal(asset.demo, true, asset.assetId);
    for (const rendition of asset.renditions) assert.equal('url' in rendition, false, asset.assetId);
  }
});
