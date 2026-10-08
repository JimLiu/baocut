const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-cut.js');
const C = window.BC_CUT;

const CUTS = [
  {id: 'a', start: 10, end: 11, kind: 'filler', state: 'cut'},
  {id: 'b', start: 30, end: 31.4, kind: 'pause', state: 'suggested'},
  {id: 'c', start: 50, end: 52, kind: 'take', state: 'cut'},
];
const CLIPS = [
  {id: 'k1', start: 0, end: 28, src: 0},
  {id: 'k2', start: 28, end: 45.2, src: 28},
  {id: 'k3', start: 45.2, end: 78, src: 45.2},
];

test('label / summary / kindsText', () => {
  assert.equal(C.label(0.84), '0.8s');
  assert.equal(C.label(72), '1 分 12 秒');
  assert.equal(C.label(120), '2 分');
  assert.deepEqual(C.summary(CUTS), {n: 3, secs: 4.4, byKind: {filler: 1, pause: 1, take: 1}});
  assert.equal(C.kindsText(CUTS), '口癖 1 处、停顿 1 处、重复起句 1 处');
});

test('accept / remove / acceptAll / rejectAll / restoreAll / withoutBatch', () => {
  assert.equal(C.accept(CUTS, 'b').find((c) => c.id === 'b').state, 'cut');
  assert.deepEqual(C.remove(CUTS, ['a', 'c']).map((c) => c.id), ['b']);
  assert.equal(C.acceptAll(CUTS).every((c) => c.state === 'cut'), true);
  assert.deepEqual(C.rejectAll(CUTS).map((c) => c.id), ['a', 'c']);
  assert.deepEqual(C.restoreAll(CUTS).map((c) => c.id), ['b']);
  const batched = C.suggest([], [{id: 'x', start: 1, end: 2, kind: 'filler'}], 'agent', 't9');
  assert.deepEqual(batched.map((c) => [c.id, c.batch, c.by, c.state]), [['t9:x', 't9', 'agent', 'suggested']]);
  assert.deepEqual(C.withoutBatch(batched.concat(CUTS), 't9').map((c) => c.id), ['a', 'b', 'c']);
});

test('add 合并重叠段并吸收被盖住的建议', () => {
  const r = C.add(CUTS, {start: 30.5, end: 33, text: '这一段'});
  assert.deepEqual(r.map((c) => [c.id, c.start, c.end, c.state]).filter((x) => x[1] >= 30 && x[1] < 40),
    [[r[1].id, 30, 33, 'cut']]);
  assert.equal(r.length, 3);
  assert.equal(r[1].kind, 'manual');
  assert.equal(r[1].by, 'you');
  assert.equal(r[1].id, 'm30000-33000');   // 手动段的 id 由区间决定，时间轴 / 文稿按它做 key
});

test('suggest 跳过与现有段重叠的建议', () => {
  const r = C.suggest(CUTS, [{id: 'dup', start: 10.5, end: 12, kind: 'filler'}, {id: 'new', start: 70, end: 71, kind: 'filler'}], 'ai');
  assert.deepEqual(r.map((c) => c.id), ['a', 'b', 'c', 'new']);
});

test('skip / toOut / outDuration / at 只看已剪段', () => {
  assert.equal(C.skip(CUTS, 10.2), 11);
  assert.equal(C.skip(CUTS, 30.5), 30.5);   // 建议态不跳
  assert.equal(C.skip([{id: 'p', start: 5, end: 6, state: 'cut'}, {id: 'q', start: 6, end: 7, state: 'cut'}], 5.5), 7);
  assert.equal(C.toOut(CUTS, 60), 57);
  assert.equal(C.toOut(CUTS, 10.5), 10);
  assert.equal(C.outDuration(206, CUTS), 203);
  assert.equal(C.at(CUTS, 30.2).id, 'b');
  assert.equal(C.at(CUTS, 20), null);
});

test('compose 派生成片 clips：抠掉已剪段、碎片贴紧、源偏移守恒', () => {
  const r = C.compose(CLIPS, CUTS);
  assert.deepEqual(r, [
    {id: 'k1.1', start: 0, end: 10, src: 0},
    {id: 'k1.2', start: 10, end: 27, src: 11},
    {id: 'k2', start: 27, end: 44.2, src: 28},
    {id: 'k3.1', start: 44.2, end: 49, src: 45.2},
    {id: 'k3.2', start: 49, end: 75, src: 52},
  ]);
  assert.equal(r[r.length - 1].end, C.outDuration(78, CUTS));
  assert.deepEqual(C.compose(CLIPS, []), CLIPS);
});

test('tokens：中文逐字、拉丁按词、标点挂前一个', () => {
  const t = (s) => C.tokens(s).map((x) => s.slice(x.s, x.e));
  assert.deepEqual(t('嗯，就是，谢谢。'), ['嗯，', '就', '是，', '谢', '谢。']);
  assert.deepEqual(t('Uh, so, thanks — I’m Zhou.'), ['Uh, ', 'so, ', 'thanks — ', 'I’m ', 'Zhou.']);
  assert.deepEqual(t('《码与远方》'), ['《码', '与', '远', '方》']);
  assert.deepEqual(t(''), []);
  // 首尾相接覆盖全文
  const s = '我definately没准备好。';
  const ts = C.tokens(s);
  assert.equal(ts[0].s, 0); assert.equal(ts[ts.length - 1].e, s.length);
  for (let i = 1; i < ts.length; i++) assert.equal(ts[i].s, ts[i - 1].e);
});

test('rangeTime / charsOf 按 cue 内字符比例互相往返', () => {
  const cues = {g1: {start: 0, end: 4}, g2: {start: 4, end: 8}};
  const cueOf = (id) => cues[id];
  const spans = [{id: 'g1', start: 0, end: 8}, {id: 'g2', start: 8, end: 16}];
  assert.deepEqual(C.rangeTime(spans, cueOf, 2, 4), {start: 1, end: 2});
  assert.deepEqual(C.rangeTime(spans, cueOf, 6, 10), {start: 3, end: 5});
  assert.deepEqual(C.rangeTime(spans, cueOf, 14, 16), {start: 7, end: 8});
  assert.equal(C.rangeTime(spans, cueOf, 20, 22), null);
  assert.deepEqual(C.charsOf(spans, cueOf, {start: 1, end: 2, kind: 'filler'}), {s: 2, e: 4, mark: false});
  assert.deepEqual(C.charsOf(spans, cueOf, {start: 3, end: 5, kind: 'take'}), {s: 6, e: 10, mark: false});
  assert.deepEqual(C.charsOf(spans, cueOf, {start: 7, end: 8, kind: 'pause'}), {s: 16, e: 16, mark: true});
  assert.equal(C.charsOf(spans, cueOf, {start: 9, end: 10, kind: 'filler'}), null);
});

test('fromSpecs：子串定位与尾部停顿，中英包引同一处', () => {
  const cues = [
    {id: 'g3', start: 7.14, end: 10.06, text: '嗯，就是，谢谢邀请，我是周远。'},
    {id: 'g11', start: 33.4, end: 36.82, text: '这一段先放个演示片段。'},
  ];
  const specs = [
    {id: 'c1', cue: 'g3', kind: 'filler', why: '口癖', find: {zh: '嗯，就是，', en: 'Uh, so,'}},
    {id: 'c2', cue: 'g11', kind: 'pause', tail: 1.4},
    {id: 'c3', cue: 'nope', kind: 'filler', find: {zh: 'x'}},
  ];
  const r = C.fromSpecs(specs, cues, 'zh');
  assert.equal(r.length, 2);
  assert.equal(r[0].id, 'c1'); assert.equal(r[0].start, 7.14); assert.equal(r[0].end, 8.113); assert.equal(r[0].text, '嗯，就是，');
  assert.equal(r[1].id, 'c2'); assert.equal(r[1].start, 35.42); assert.equal(r[1].end, 36.82); assert.equal(r[1].text, '（停顿 1.4s）');
  const en = C.fromSpecs(specs, [{id: 'g3', start: 7.14, end: 10.06, text: 'Uh, so, thanks for having me.'}], 'en');
  assert.equal(en[0].text, 'Uh, so,');
  assert.equal(en[0].start, 7.14);
});

test('toTimeline：按包住起点的主视频元素平移，找不到就原样', () => {
  const els = [
    {id: 'v1', kind: 'video', fromSource: true, start: 0, end: 10, srcStart: 0},
    {id: 'v2', kind: 'video', fromSource: true, start: 12, end: 20, srcStart: 10},   // 源片 10–18 被挪到 12–20
    {id: 'b', kind: 'video', start: 0, end: 30, srcStart: 0},                          // B-roll 不参与
  ];
  assert.deepEqual(C.toTimeline(els, 3, 4), {start: 3, end: 4});
  assert.deepEqual(C.toTimeline(els, 11, 13.5), {start: 13, end: 15.5});
  assert.deepEqual(C.toTimeline(els, 25, 26), {start: 25, end: 26});
});

test('foldMap：已剪段折叠成成片时钟、缝并位、展开态恒等（第 197 轮）', () => {
  const els = [
    {id: 'v1', kind: 'video', fromSource: true, start: 0, end: 10, srcStart: 0},
    {id: 'v2', kind: 'video', fromSource: true, start: 12, end: 20, srcStart: 10},   // 源片 10–18 挪到 12–20
  ];
  const cuts = [
    {id: 'a', start: 2, end: 3, kind: 'filler', state: 'cut'},
    {id: 'a2', start: 3, end: 3.5, kind: 'pause', state: 'cut'},                     // 与 a 相邻：同一道缝
    {id: 'b', start: 11, end: 12, kind: 'pause', state: 'suggested'},                 // 建议不折叠
    {id: 'c', start: 15, end: 16, kind: 'manual', state: 'cut'},                      // 在挪过位的 v2 里 → 时间轴 17–18
  ];
  const m = C.foldMap(cuts, els);
  assert.deepEqual(m.slots.map((x) => [x.id, x.start, x.end, x.sug]),
    [['a', 2, 3, false], ['a2', 3, 3.5, false], ['b', 13, 14, true], ['c', 17, 18, false]], '剪口按 srcStart 平移到时间轴');
  assert.deepEqual(m.spans, [{start: 2, end: 3.5}, {start: 17, end: 18}], '相邻已剪段并成一段折叠');
  assert.equal(m.fold(1), 1);
  assert.equal(m.fold(2.5), 2, '段内折到段起点');
  assert.equal(m.fold(5), 3.5);
  assert.equal(m.fold(20), 17.5);
  assert.equal(m.unfold(2), 3.5, '缝上的成片时刻回到段尾（播放头落在保留内容上）');
  assert.equal(m.unfold(3), 4.5);
  assert.equal(m.unfold(16), 18.5);
  assert.equal(m.skip(2.7), 3.5);
  assert.equal(m.skip(13.5), 13.5, '建议段不跳');
  assert.deepEqual(m.seams.map((x) => [x.f, x.ids, x.secs, x.kinds]),
    [[2, ['a', 'a2'], 1.5, ['filler', 'pause']], [15.5, ['c'], 1, ['manual']]]);
  assert.equal(m.view(5), 3.5); assert.equal(m.unview(3.5), 5); assert.equal(m.has, true);
  const e = C.foldMap(cuts, els, {expanded: true});
  assert.equal(e.view(5), 5); assert.equal(e.unview(5), 5, '展开态：位置恒等');
  assert.equal(e.fold(5), 3.5, '但成片时钟不变——刻度数字仍按它标');
  const none = C.foldMap([], els);
  assert.equal(none.has, false); assert.equal(none.fold(7), 7); assert.equal(none.unfold(7), 7);
});

test('keptPieces：抠掉已剪段后按行内分割，整段剪掉为空（第 196 轮）', () => {
  assert.deepEqual(C.keptPieces(CUTS, 9, 12), [{start: 9, end: 10}, {start: 11, end: 12}], '中间剪一刀 → 两片');
  assert.deepEqual(C.keptPieces(CUTS, 10, 11), [], '整句在剪段里');
  assert.deepEqual(C.keptPieces(CUTS, 29, 32), [{start: 29, end: 32}], '建议态不算');
  assert.deepEqual(C.keptPieces(CUTS, 49, 51), [{start: 49, end: 50}], '尾巴被剪');
  assert.deepEqual(C.keptPieces(CUTS, 20, 25), [{start: 20, end: 25}]);
});

test('cueImpact / transStale / transImpact / fixTrans：原文被剪切的译文待处理，只剪停顿不算', () => {
  const cuts = CUTS.concat([{id: 'p', start: 70, end: 70.9, kind: 'pause', state: 'cut'}]);
  const cues = [
    {id: 'g1', start: 9, end: 12},
    {id: 'g2', start: 20, end: 25},
    {id: 'g3', start: 49, end: 51},
    {id: 'g4', start: 68, end: 70.9},
    {id: 'g5', start: 10.2, end: 10.8, transCutFix: 'a'},
  ];
  const im = C.cueImpact(cuts, cues[0]);
  assert.equal(im.removed, 1);
  assert.equal(im.whole, false);
  assert.equal(im.words, true);
  assert.equal(im.sig, 'a');
  assert.equal(C.cueImpact(cuts, cues[1]), null);
  assert.equal(C.cueImpact(cuts, cues[3]).words, false, '只剪了句尾停顿');
  assert.equal(C.cueImpact(cuts, cues[4]).whole, true);
  assert.equal(C.transStale(cuts, cues[3]), null, '停顿不影响译文');
  assert.equal(C.transStale(cuts, cues[4]), null, '已按这一版处理过');
  const r = C.transImpact(cuts, cues);
  assert.deepEqual(r.stale.map((x) => x.id), ['g1', 'g3']);
  assert.equal(r.partial, 2);
  assert.equal(r.whole, 0);
  assert.equal(r.trimmed, 1);
  assert.equal(r.fixed, 1);
  const f = C.fixTrans(cuts, cues);
  assert.deepEqual(f.ids, ['g1', 'g3']);
  assert.equal(f.cues[0].transCutFix, 'a');
  assert.equal(f.cues[2].transCutFix, 'c');
  assert.equal(C.transImpact(cuts, f.cues).stale.length, 0, '处理过就清零');
  // 再补一刀，sig 变了，重新待处理
  const more = cuts.concat([{id: 'z', start: 11.5, end: 11.8, kind: 'manual', state: 'cut'}]);
  assert.deepEqual(C.transImpact(more, f.cues).stale.map((x) => x.id), ['g1']);
  assert.equal(C.cueImpact(more, f.cues[0]).sig, 'a+z');
  const same = cues.slice(1, 2);
  assert.equal(C.fixTrans(cuts, same).cues, same, '无待处理时原数组原样返回');
});

test('第 199 轮：改字态抠掉已剪词——吞连接空白、相邻并段、文末向前吞', () => {
  let v = C.hideChars('a b c d', [{s: 2, e: 3}]);
  assert.equal(v.text, 'a c d');
  assert.deepEqual(v.hidden, [{at: 2, text: 'b '}]);
  v = C.hideChars('a b c', [{s: 4, e: 5}]);
  assert.equal(v.text, 'a b');
  assert.deepEqual(v.hidden, [{at: 3, text: ' c'}]);
  v = C.hideChars('a b c d', [{s: 4, e: 5}, {s: 2, e: 3}, {s: 2, e: 3}]);
  assert.equal(v.text, 'a d');
  assert.deepEqual(v.hidden, [{at: 2, text: 'b c '}]);
  v = C.hideChars('今天很好啊', [{s: 2, e: 4}]);
  assert.equal(v.text, '今天啊');
  assert.deepEqual(v.hidden, [{at: 2, text: '很好'}]);
  assert.deepEqual(C.hideChars('abc', []), {text: 'abc', hidden: []});
});

test('第 199 轮：放回隐藏段——原文恒等、前后缀跟随、被改写吞掉', () => {
  const h = [{at: 2, text: 'b '}];
  assert.equal(C.restoreHidden('a c d', 'a c d', h), 'a b c d', '没改就是全文');
  assert.equal(C.restoreHidden('a c d', 'a c dd', h), 'a b c dd', '尾部续写：前缀里的段原位');
  assert.equal(C.restoreHidden('a c d', 'a X d', h), 'a b X d', '改写落点之后的词，段仍在');
  assert.equal(C.restoreHidden('a c', 'a c e', [{at: 3, text: ' d'}]), 'a c e d', '文末段贴着段尾');
  assert.equal(C.restoreHidden('b c', 'Zb c', [{at: 0, text: 'a '}]), 'a Zb c', '段首段贴着段首');
  assert.equal(C.restoreHidden('a b d e', 'a X e', [{at: 4, text: 'c '}]), 'a X e', '被整段改写吞掉');
  assert.equal(C.restoreHidden('x', 'y', []), 'y');
  assert.equal(C.restoreHidden('今天啊', '今天呢', [{at: 2, text: '很好'}]), '今天很好呢');
});

test('第 199 轮：editView 只对剪到字的段建投影，停顿不参与', () => {
  const cues = [{id: 'c1', start: 0, end: 10, text: '今天呢很好啊'}, {id: 'c2', start: 10, end: 20, text: '就这样'}];
  const cueOf = (id) => cues.find((c) => c.id === id);
  const text = '今天呢很好啊就这样';
  const spans = [{id: 'c1', start: 0, end: 6}, {id: 'c2', start: 6, end: 9}];
  const cuts = [
    {id: 'f', start: 10 / 3, end: 5, kind: 'filler', state: 'cut'},         // 「呢」
    {id: 'p', start: 9, end: 10, kind: 'pause', state: 'cut'},              // 停顿：没有字
    {id: 's', start: 10, end: 15, kind: 'filler', state: 'suggested'},      // 建议态不生效
  ];
  const v = C.editView(text, spans, cueOf, cuts);
  assert.equal(v.text, '今天很好啊就这样');
  assert.deepEqual(v.hidden, [{at: 2, text: '呢'}]);
  assert.equal(C.editView(text, spans, cueOf, cuts.slice(1)), null, '只剩停顿与建议 → 不建投影');
  assert.equal(C.editView(text, spans, cueOf, []), null);
});

test('dropped：整段落在已剪区间里才算丢，半截不算', () => {
  const cuts = [{id: 'a', start: 10, end: 20, kind: 'filler', state: 'cut'}, {id: 'b', start: 30, end: 40, kind: 'pause', state: 'suggested'}];
  assert.equal(C.dropped(cuts, {start: 12, end: 18}), true);
  assert.equal(C.dropped(cuts, {start: 10, end: 20}), true);
  assert.equal(C.dropped(cuts, {start: 8, end: 12}), false);
  assert.equal(C.dropped(cuts, {start: 32, end: 38}), false, '建议态不是剪口');
  assert.equal(C.dropped([], {start: 12, end: 18}), false);
});

test('seamRows：连着剪光的段折成一条缝，秒数按剪口交集算', () => {
  const paras = [
    {id: 'p1', start: 0, end: 10},
    {id: 'p2', start: 10, end: 20},
    {id: 'p3', start: 20, end: 30},
    {id: 'p4', start: 30, end: 40},
  ];
  const cuts = [
    {id: 'c1', start: 8, end: 22, kind: 'manual', state: 'cut'},     // 盖住 p2，两头伸到邻段
    {id: 'c2', start: 22, end: 30, kind: 'filler', state: 'cut'},    // 盖住 p3 后半
    {id: 'c3', start: 34, end: 36, kind: 'pause', state: 'suggested'},
  ];
  const gone = new Set(['p2', 'p3']);
  const rows = C.seamRows(paras, (p) => gone.has(p.id), cuts);
  assert.deepEqual(rows.map((r) => r.kind), ['para', 'seam', 'para']);
  const seam = rows[1];
  assert.deepEqual(seam.paras.map((p) => p.id), ['p2', 'p3'], '相邻两段合成一条');
  assert.deepEqual([seam.start, seam.end], [10, 30]);
  assert.deepEqual(seam.cutIds, ['c1', 'c2'], '建议态不算进恢复清单');
  assert.equal(seam.secs, 20, '剪口按缝的区间夹取后相加');
});

test('seamRows：没剪光就不折，全篇剪光只出一条缝', () => {
  const paras = [{id: 'p1', start: 0, end: 10}, {id: 'p2', start: 10, end: 20}];
  assert.deepEqual(C.seamRows(paras, () => false, []).map((r) => r.kind), ['para', 'para']);
  const all = C.seamRows(paras, () => true, []);
  assert.equal(all.length, 1);
  assert.equal(all[0].secs, 20, '没有剪口记录时退回段落时长');
  assert.deepEqual(all[0].cutIds, []);
  assert.deepEqual(C.seamRows([], () => true, []), []);
});

/* ---------- 拖空槽带边缘（2026-10-01，内核 retimeCut / drag_cut_edge 的原型镜像）---------- */
// 两条 cue：第一条 1 字 = 1 s（`aa ` 0–3、`bb ` 3–6、`cc ` 6–9、`dd ` 9–12、`ee` 12–14），
// 第二条 20–26 有 6 s 的空档在前（`ff ` 20–23.6、`gg` 23.6–26）
const DCUES = [{id: 'q2', start: 20, end: 26, text: 'ff gg'}, {id: 'q1', start: 0, end: 14, text: 'aa bb cc dd ee'}];
const WORDS = C.wordTimes(DCUES);
const DCUTS = [
  {id: 'a', start: 6, end: 9, kind: 'filler', state: 'cut', by: 'ai', batch: 't1', text: 'cc '},
  {id: 'b', start: 12, end: 14, kind: 'manual', state: 'cut', by: 'you'},
  {id: 's', start: 22, end: 23, kind: 'pause', state: 'suggested', by: 'ai'},
];
const OPT = {duration: 30};

test('wordTimes：按 cue 起点排序、token 按字符比例铺开', () => {
  assert.equal(WORDS.length, 7);
  assert.deepEqual(WORDS.slice(0, 2).map((w) => [w.t0, w.t1]), [[0, 3], [3, 6]]);
  assert.deepEqual([WORDS[5].t0, Math.round(WORDS[5].t1 * 1000) / 1000], [20, 23.6]);
});

test('wordSpanStart / wordSpanEnd：小留白 + 帧对齐，不越相邻词', () => {
  assert.equal(C.wordSpanStart(WORDS, 1, 30, C.WORD_PAD), 3, '紧挨前一词就落在词缝上');
  assert.ok(Math.abs(C.wordSpanStart(WORDS, 5, 30, C.WORD_PAD) - 598 / 30) < 1e-9, '前面有空档：留 0.05s 再向前取整到帧');
  assert.ok(Math.abs(C.wordSpanEnd(WORDS, 4, 30, 30, C.WORD_PAD) - 422 / 30) < 1e-9, '后面有空档：留 0.05s 再向后取整到帧');
});

test('dragEdge：缺省吸词边界，取最近的候选', () => {
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'start', 4.2, OPT), {start: 3, end: 9});
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'start', 5.1, OPT), {start: 6, end: 9});
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'b', 'end', 21, OPT), {start: 12, end: 23.6}, '越过建议，吸到 ff 的尾');
});

test('dragEdge：Alt 自由落点按帧对齐；没有词时也退回自由', () => {
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'start', 4.21, Object.assign({snap: false}, OPT)), {start: 4.2, end: 9});
  assert.deepEqual(C.dragEdge(DCUTS, [], 'a', 'start', 4.519, OPT), {start: 4.533, end: 9});
});

test('dragEdge：夹取——相邻已剪段、一帧宽、[0, duration]，越界贴在极限上', () => {
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'end', 13, OPT), {start: 6, end: 12}, '不越过后一处已剪');
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'b', 'start', 7, OPT), {start: 9, end: 14}, '不越过前一处已剪（贴边可以）');
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'end', 2, OPT), {start: 6, end: 6.033}, '至少一帧宽');
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'a', 'start', -5, OPT), {start: 0, end: 9});
  assert.deepEqual(C.dragEdge(DCUTS, WORDS, 'b', 'end', 99, OPT), {start: 12, end: 30});
  assert.equal(C.dragEdge(DCUTS, WORDS, 'nope', 'end', 5, OPT), null);
});

test('dragSlotEdge：像素 → 源时刻，预览只平移被拖的边；按下没动原样', () => {
  // 主视频挪过位：时间轴比源晚 2 s
  const slot = {id: 'a', cut: DCUTS[0], start: 8, end: 11, sug: false};
  const still = C.dragSlotEdge(slot, DCUTS, WORDS, 'start', 100, 100, 20, false, OPT);
  assert.deepEqual([still.t0, still.t1, still.start, still.end, still.changed], [6, 9, 8, 11, false]);
  const snap = C.dragSlotEdge(slot, DCUTS, WORDS, 'start', 100, 46, 20, false, OPT);
  assert.deepEqual([snap.t0, snap.t1, snap.start, snap.end, snap.changed], [3, 9, 5, 11, true]);
  const free = C.dragSlotEdge(slot, DCUTS, WORDS, 'start', 100, 46, 20, true, OPT);
  assert.deepEqual([free.t0, free.start], [3.3, 5.3]);
});

test('retime：保留 id / kind / by / batch，吸收被盖住的建议，没变返回原数组', () => {
  const r = C.retime(DCUTS, 'a', 3, 9);
  const a = r.find((c) => c.id === 'a');
  assert.deepEqual([a.start, a.end, a.kind, a.by, a.batch, a.state, a.text], [3, 9, 'filler', 'ai', 't1', 'cut', 'cc ']);
  assert.equal(r.length, 3);
  const wide = C.retime(DCUTS, 'b', 12, 23.6);
  assert.deepEqual(wide.map((c) => c.id), ['a', 'b'], '建议被新区间盖住就拿走');
  assert.equal(C.retime(DCUTS, 'a', 6, 9), DCUTS, '区间没变不写');
  assert.equal(C.retime(DCUTS, 'nope', 1, 2), DCUTS);
});
