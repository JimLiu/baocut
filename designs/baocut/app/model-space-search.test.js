const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-semantic.js');
require('./model-space-search.js');
const D = window.BC_DATA;
const S = window.BC_SEMANTIC;
const Q = window.BC_SPACE_SEARCH;
const SEM = D.semantic;
const dirOf = (v) => (D.projects.find((p) => p.id === v) || {}).dir;
const base = {corpus: SEM.corpus, concepts: SEM.concepts, cutOut: SEM.cutOut, dirOf};

test('演示语料都引用得到：概念表的命中都在语料里', () => {
  const ids = new Set(SEM.corpus.map((c) => c.id));
  SEM.concepts.forEach((c) => c.hits.forEach((h) => assert.ok(ids.has(h), h)));
  SEM.corpus.forEach((c) => assert.ok(dirOf(c.video), c.video));
});

test('综合：按意思找到原句里没有这些字的片段，且不画高亮（v0.1 §11.3）', () => {
  const r = Q.search('我哪一期讲过离线？', Object.assign({mode: 'mix', scope: 'all', status: S.status({})}, base));
  assert.equal(r.mode, 'hybrid');
  assert.ok(r.results.length >= 2);
  r.results.forEach((x) => { assert.equal(x.by, 'semantic'); assert.equal(x.hl, null); });
  assert.ok(r.results.every((x) => !('score' in x) && !('order' in x)));
});

test('字面命中给真高亮；两路都命中的排前', () => {
  const r = Q.search('确定性', Object.assign({mode: 'mix', scope: 'all', status: S.status({})}, base));
  assert.equal(r.results[0].id, 'p1:g12');
  assert.equal(r.results[0].by, 'both');
  assert.deepEqual(Q.pieces(r.results[0].text, r.results[0].hl).filter((p) => p.hl).map((p) => p.t), ['确定性']);
});

test('没装模型：综合退回精确文字并说明；精确文字模式本身不算退回（§2.11）', () => {
  const st = S.status({install: 'none'});
  const r = Q.search('为什么不上传素材', Object.assign({mode: 'mix', scope: 'all', status: st}, base));
  assert.equal(r.mode, 'lexical');
  assert.ok(r.degraded);
  assert.equal(Q.notices(r, st, S)[0].text, S.ENTRY.search.not);
  const e = Q.search('确定性', Object.assign({mode: 'exact', scope: 'all', status: S.status({})}, base));
  assert.equal(e.degraded, false);
  assert.ok(e.results.every((x) => x.by === 'exact'));
  const stale = S.status({index: 'stale'});
  assert.equal(Q.notices(Q.search('成本', Object.assign({mode: 'mix', status: stale}, base)), stale, S)[0].text, S.STALE_NOTE);
});

test('范围：这个项目只看本项目的视频；剪掉的句子没有「在时间线打开」', () => {
  const r = Q.search('为什么不上传素材', Object.assign({mode: 'mix', scope: 'project', dir: 'd1', status: S.status({})}, base));
  assert.ok(r.results.length && r.results.every((x) => dirOf(x.video) === 'd1'));
  const all = Q.search('为什么不上传素材', Object.assign({mode: 'mix', scope: 'all', status: S.status({})}, base));
  assert.ok(all.results.length > r.results.length);
  const cost = Q.search('成本', Object.assign({mode: 'mix', scope: 'all', status: S.status({})}, base));
  assert.equal(cost.results.find((x) => x.id === 'p4:c2').inTimeline, false);
});

test('完整性按项目算，全部项目时写明还在转录的；问答在不全时提醒', () => {
  const one = Q.coverage('project', 'd1', SEM.projects, S);
  assert.match(one.line, /^文字已就绪/);
  assert.equal(one.partial, false);
  const all = Q.coverage('all', null, SEM.projects, S);
  assert.ok(all.partial);
  assert.match(all.line, /还在转录/);
  const res = Q.search('我哪一期讲过离线？', Object.assign({mode: 'mix', scope: 'all', status: S.status({})}, base)).results;
  const a = Q.answer('x', res, {p8: '口播', p4: '访谈'}, all);
  assert.ok(a.lines.length && a.lines.every((l) => l.cites.length));
  assert.match(a.note, /可能漏了/);
  assert.ok(Q.looksLikeQuestion('我哪一期讲过离线？'));
  assert.ok(!Q.looksLikeQuestion('确定性'));
});

const movies = () => D.projects.map((p) => ({id: p.id, kind: 'movie', name: p.title, dir: p.dir, origin: p.origin ? p.origin.project : null}));

test('相关视频：按整部视频的意思找，每部给最接近的那一句，不列自己切出的短视频与回收站里的', () => {
  const items = movies();
  const r = Q.related('p1', {items, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({})});
  assert.equal(r.by, 'semantic');
  assert.equal(r.reason, null);
  assert.ok(r.rows.length >= 2);
  assert.ok(r.rows.every((x) => x.why && x.why.text && Number.isFinite(x.why.t) && !('score' in x)));
  const ids = r.rows.map((x) => x.video);
  assert.ok(!ids.includes('p1'));
  ['p5', 'p12'].forEach((id) => assert.equal(items.find((i) => i.id === id).origin, 'p1'));
  assert.ok(!ids.includes('p5') && !ids.includes('p12'));
  assert.equal(r.rows[0].why.text, SEM.corpus.find((c) => c.video === r.rows[0].video && c.text === r.rows[0].why.text).text);
  const trashed = items.map((i) => (i.id === ids[0] ? Object.assign({}, i, {trashed: true}) : i));
  assert.ok(!Q.related('p1', {items: trashed, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({})}).rows.some((x) => x.video === ids[0]));
  // 短视频那一头：来源视频不列
  const short = Q.related('p12', {items: items.map((i) => (i.id === 'p12' ? Object.assign({}, i) : i)), corpus: SEM.corpus.concat([{id: 'p12:x', video: 'p12', t: 1, text: '本地'}]),
    concepts: SEM.concepts.concat([{k: 'x', keys: [], hits: ['p12:x', 'p1:g5', 'p8:t1']}]), status: S.status({})});
  assert.ok(short.rows.length && !short.rows.some((x) => x.video === 'p1'));
  assert.equal(Q.relatedNote(r), null);
  assert.equal(Q.relatedNote(Q.related('p1', {items, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({index: 'stale'})})).tone, 'notice');
});

test('相关视频：没装模型、这部视频没建好索引时退回名字相近，写明原因', () => {
  const items = movies();
  const none = Q.related('p1', {items, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({install: 'none'})});
  assert.equal(none.by, 'name');
  assert.equal(none.reason, 'MODEL_NOT_INSTALLED');
  assert.ok(none.rows.length && none.rows.every((x) => x.shared && x.why === null));
  assert.ok(!none.rows.some((x) => ['p1', 'p5', 'p12'].includes(x.video)));
  assert.equal(Q.relatedNote(none).settings, true);
  const unsupported = Q.related('p1', {items, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({platform: 'unsupported'})});
  assert.equal(Q.relatedNote(unsupported).settings, false);
  const notIndexed = Q.related('p13', {items, corpus: SEM.corpus, concepts: SEM.concepts, status: S.status({})});
  assert.equal(notIndexed.by, 'name');
  assert.equal(notIndexed.reason, 'INDEX_NOT_READY');
  assert.ok(notIndexed.rows.some((x) => x.video === 'p8' && x.shared === '口播'));
  assert.equal(Q.sharedName('课程 03 · 确定性渲染', '课程 04 · 剪辑'), '课程');
  assert.equal(Q.sharedName('EN → 中', 'Code & Wander · ENGLISH'), null, '拉丁写法落在词边界上');
  assert.equal(Q.sharedName('第 03 讲', '第 03 期'), null, '纯数字与单字不算');
});

test('编辑器查找片段：只列这部视频里意思相近、原句里没有这些字的句子，按时间排；语义不能用、正则、太短时不列', () => {
  const o = {corpus: SEM.corpus, concepts: SEM.concepts, video: 'p1', status: S.status({})};
  const r = Q.inVideo('为什么不上传', o);
  assert.equal(r.usable, true);
  assert.ok(r.rows.length > 0 && r.rows.length <= Q.IN_VIDEO_SHOWN);
  assert.ok(r.rows.every((x) => x.id.startsWith('p1:')));
  assert.deepEqual(r.rows.map((x) => x.t), r.rows.map((x) => x.t).slice().sort((a, b) => a - b));
  const lit = Q.search('本地', {corpus: SEM.corpus.filter((c) => c.video === 'p1'), concepts: SEM.concepts, mode: 'mix', status: S.status({})});
  const literal = lit.results.filter((x) => x.by !== 'semantic').map((x) => x.id);
  assert.ok(!Q.inVideo('本地', o).rows.some((x) => literal.includes(x.id)));
  assert.deepEqual(Q.inVideo('为什么不上传', Object.assign({}, o, {status: S.status({install: 'none'})})), {usable: false, stale: false, rows: []});
  assert.equal(Q.inVideo('隐', o).rows.length, 0);
  assert.equal(Q.inVideo('隐私', Object.assign({}, o, {regex: true})).rows.length, 0);
});

test('弱命中折起来：有明显相关的才折，全是弱命中时照常全给', () => {
  const r = (id, weak) => ({id, weak});
  assert.deepEqual(Q.fold([r('a', false), r('b', true), r('c', false), r('d', true)]), {
    shown: [r('a', false), r('c', false)],
    folded: [r('b', true), r('d', true)],
  });
  assert.deepEqual(Q.fold([r('a', true), r('b', true)]), {shown: [r('a', true), r('b', true)], folded: []});
  assert.deepEqual(Q.fold([]), {shown: [], folded: []});
  const res = Q.search('预算', Object.assign({}, base, {mode: 'mix', limit: 20}));
  const f = Q.fold(res.results);
  assert.equal(f.shown.length + f.folded.length, res.results.length);
});

test('命中原因：字面对上的写出对上的词；只按意思的写意思接近；不编概念名、不写分数', () => {
  const st = S.status({});
  const both = Q.search('确定性', Object.assign({mode: 'mix', scope: 'all', status: st}, base)).results[0];
  assert.equal(Q.why(both), '说到了「确定性」，意思也对得上');
  const exact = Q.search('确定性', Object.assign({mode: 'exact', scope: 'all', status: st}, base)).results[0];
  assert.equal(Q.why(exact), '说到了「确定性」');
  const sem = Q.search('我哪一期讲过离线？', Object.assign({mode: 'mix', scope: 'all', status: st}, base)).results;
  sem.filter((x) => !x.weak).forEach((x) => assert.equal(Q.why(x), '意思接近，原句里没有这些字'));
  assert.equal(Q.why({by: 'semantic', weak: true, text: 'x', hl: null}), Q.BY.weak);
  // 同一个词出现两次只写一次，最多写 3 个
  assert.equal(Q.why({by: 'exact', text: 'ab ab cd ef gh', hl: [[0, 2], [3, 5], [6, 8], [9, 11], [12, 14]]}), '说到了「ab」「cd」「ef」');
});

test('预览那一段：命中那句前后各留 2 秒，不早于 0；没有结束时间时按 4 秒', () => {
  assert.deepEqual(Q.moment({t: 37, end: 42}), {from: 35, to: 44, hit: [37, 42]});
  assert.deepEqual(Q.moment({t: 1, end: 3}), {from: 0, to: 5, hit: [1, 3]});
  assert.deepEqual(Q.moment({t: 10}), {from: 8, to: 16, hit: [10, 14]});
});
