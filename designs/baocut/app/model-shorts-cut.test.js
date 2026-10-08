const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
const M = require('./model-shorts-cut.js');

/* 与 data.js makeCues 同一份节奏：62 句铺满 206 秒，抖动是固定序列。 */
const DUR = 206, N = 62;
const JITTER = [0, 0.5, -0.4, 0.3, -0.6, 0.2, 0.6, -0.3, 0.4, -0.5, 0.1];
function sentences(n = N, dur = DUR) {
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? dur : +Math.min(dur, t + dur / n + JITTER[i % JITTER.length]).toFixed(2);
    out.push({id: 'g' + (i + 1), start: +t.toFixed(2), end, sp: 's1', text: '第 ' + (i + 1) + ' 句', trans: 'Line ' + (i + 1)});
    t = end;
  }
  return out;
}
const S = sentences();
const parent = {id: 'p1', title: '科浪访谈双语版', entry: 'trans', lang: '中文', model: 'moss-transcribe', hue: 252,
  src: {name: 'kelang-ep42-master.mp4', res: '1920×1080'}};
const child = (id, from, to, extra) => Object.assign({id, title: '短视频切片 · ' + id,
  origin: {project: 'p1', in: S[from].start, out: S[to].end}}, extra);

test('参数：缺省值、条数夹在 1–10、时长档与平台提醒', () => {
  assert.equal(M.DEFAULTS.count, 3);
  assert.equal(M.DEFAULTS.length, 'mid');
  assert.equal(M.DEFAULTS.focus, 'speaker');
  assert.equal(M.FOCUS[0].id, 'speaker');
  assert.equal(M.clampCount(0), 1);
  assert.equal(M.clampCount(99), 10);
  assert.equal(M.clampCount('x'), 3);
  assert.deepEqual(M.LENGTHS.map((l) => [l.min, l.max]), [[15, 30], [30, 60], [60, 90]]);
  assert.equal(M.lengthNote('mid'), '');
  assert.match(M.lengthNote('long'), /超过 60 秒/);
  assert.equal(M.summaryLine({count: 4, length: 'short', focus: 'center'}), '4 支 · 每支 15–30 秒 · 居中');
});

test('参数落到项目上：没有译文只有原文；竖屏原片不取景；没切过时不记「不再找」', () => {
  const a = M.normalize({tracks: 'both', focus: 'manual', skipDone: false}, {hasTrans: false, portrait: true, children: 0});
  assert.equal(a.tracks, 'orig');
  assert.equal(a.focus, 'center');
  assert.equal(a.skipDone, true);
  const b = M.normalize({tracks: 'trans', focus: 'manual', skipDone: false}, {hasTrans: true, portrait: false, children: 2});
  assert.deepEqual([b.tracks, b.focus, b.skipDone], ['trans', 'manual', false]);
});

test('取景缺省跟着说话的人：没给、给了不认识的都落到它；竖屏原片仍不取景', () => {
  const ctx = {hasTrans: true, portrait: false, children: 0};
  assert.equal(M.normalize({}, ctx).focus, 'speaker');
  assert.equal(M.normalize({focus: 'nope'}, ctx).focus, 'speaker');
  assert.equal(M.normalize({focus: 'center'}, ctx).focus, 'center');
  assert.equal(M.normalize({}, Object.assign({}, ctx, {portrait: true})).focus, 'center');
  assert.equal(M.focusOf('nope').id, 'speaker');
  assert.equal(M.summaryLine(M.normalize({}, ctx)), '3 支 · 每支 30–60 秒 · 跟着说话的人');
});

test('吸附：模型给的时间落到最近的句首和句尾，终点不会跑到起点前面', () => {
  const r = M.snap(S, S[4].start + 0.9, S[9].end - 1.1);
  assert.deepEqual([r.from, r.to], [4, 9]);
  assert.equal(r.start, S[4].start);
  assert.equal(r.end, S[9].end);
  const tiny = M.snap(S, S[8].start + 0.2, S[6].end);
  assert.ok(tiny.to >= tiny.from);
});

test('挪一句：每按一次只挪一句，到头和会把这一段挪没时不动', () => {
  const seg = Object.assign({id: 'x'}, M.rangeOf(S, 4, 6));
  const a = M.nudge(S, seg, 'start', -1);
  assert.deepEqual([a.from, a.to, a.start], [3, 6, S[3].start]);
  const b = M.nudge(S, seg, 'end', 1);
  assert.deepEqual([b.from, b.to, b.end], [4, 7, S[7].end]);
  const one = Object.assign({id: 'y'}, M.rangeOf(S, 5, 5));
  assert.equal(M.nudge(S, one, 'start', 1), one, '只剩一句时起点不能再往后');
  assert.equal(M.nudge(S, one, 'end', -1), one, '只剩一句时终点不能再往前');
  const head = Object.assign({id: 'h'}, M.rangeOf(S, 0, 3));
  assert.equal(M.nudge(S, head, 'start', -1), head);
  const tail = Object.assign({id: 't'}, M.rangeOf(S, 58, N - 1));
  assert.equal(M.nudge(S, tail, 'end', 1), tail);
  assert.equal(M.canNudge(S, seg, 'start', 2), false);
});

test('拖两端：吸附到句子边界，至少留一句', () => {
  const seg = Object.assign({id: 'x'}, M.rangeOf(S, 10, 14));
  const a = M.dragEdge(S, seg, 'start', S[12].start + 0.3);
  assert.deepEqual([a.from, a.to], [12, 14]);
  const b = M.dragEdge(S, seg, 'start', S[20].start);
  assert.deepEqual([b.from, b.to], [14, 14]);
  const c = M.dragEdge(S, seg, 'end', S[3].end);
  assert.deepEqual([c.from, c.to], [10, 10]);
});

test('来源关系：父 → 子靠反查，徽标文案，来源视频不在时说清楚', () => {
  const c1 = child('c1', 37, 53), c2 = child('c2', 4, 13), other = {id: 'z', title: '别的项目'};
  const all = [parent, c1, other, c2];
  assert.deepEqual(M.childrenOf(all, 'p1').map((p) => p.id), ['c2', 'c1'], '按在原片里的先后');
  assert.equal(M.childrenOf(all, 'z').length, 0);
  assert.equal(M.parentOf(all, c1).id, 'p1');
  assert.equal(M.parentOf(all, other), null);
  const l = M.originLabel(all, c1);
  assert.equal(l.missing, false);
  assert.equal(l.text, `来自「科浪访谈双语版」· ${M.mmss(S[37].start)} – ${M.mmss(S[53].end)}`);
  const gone = M.originLabel([c1, other], c1);
  assert.deepEqual([gone.missing, gone.text], [true, '来源视频已不在视频库']);
  assert.equal(M.originLabel(all, other), null);
  assert.equal(M.countLabel(3), '3 支短视频');
  assert.match(M.deleteNote(3), /3 支短视频不受影响/);
  assert.equal(M.deleteNote(0), '');
});

test('已切过：重叠超过候选时长的一半才算，按现在用到的区间判', () => {
  const c = child('c1', 37, 53);
  const inside = Object.assign({id: 'a'}, M.rangeOf(S, 40, 48));
  const edge = Object.assign({id: 'b'}, M.rangeOf(S, 30, 39));   // 10 句里只有 3 句重叠
  const half = Object.assign({id: 'h'}, M.rangeOf(S, 32, 41));   // 10 句里 5 句重叠，时长正好在线上下
  assert.equal(M.doneBy(inside, [c]).id, 'c1');
  assert.equal(M.doneBy(edge, [c]), null);
  const o = M.overlapSec(half, {start: c.origin.in, end: c.origin.out}) / (half.end - half.start);
  assert.equal(!!M.doneBy(half, [c]), o > 0.5);
  // 这一支后来把那一段剪掉了：现状里没有，就不算切过
  const trimmed = child('c1', 37, 53, {used: [{in: S[50].start, out: S[53].end}]});
  assert.equal(M.doneBy(inside, [trimmed]), null);
});

test('提醒：固定次序与文案；重叠只和勾上的别的候选比', () => {
  const params = {length: 'mid', tracks: 'both'};
  const a = Object.assign({id: 'a', on: true}, M.rangeOf(S, 4, 13));
  const b = Object.assign({id: 'b', on: false, weak: true}, M.rangeOf(S, 11, 22));
  const list = [a, b];
  const fb = M.flags(b, {params, list, children: [], sentences: S});
  assert.deepEqual(fb.map((f) => f.k), ['overlap', 'context']);
  assert.equal(fb[0].text, `和第 1 段重叠 ${Math.round(M.overlapSec(a, b))} 秒`);
  assert.equal(fb[1].text, '要靠前文才听得懂');
  assert.deepEqual(M.flags(a, {params, list, children: [], sentences: S}), [], 'b 没勾，a 不提重叠');

  const long = Object.assign({id: 'l', on: true}, M.rangeOf(S, 0, 20));   // 约 70 秒
  const fl = M.flags(long, {params, list: [long], children: [child('c1', 2, 18)], sentences: S});
  assert.deepEqual(fl.map((f) => f.k), ['done', 'over60', 'long']);
  assert.match(fl[0].text, /^已切过 · 「/);
  assert.equal(fl[2].text, `比你要的长 ${Math.round(long.end - long.start - 60)} 秒`);

  const short = Object.assign({id: 's', on: true}, M.rangeOf(S, 5, 8));
  assert.deepEqual(M.flags(short, {params, list: [short], sentences: S}).map((f) => f.k), ['short']);
  // 差不到 1 秒不提
  const near = {id: 'n', on: true, from: 0, to: 8, start: 0, end: 29.6};
  assert.deepEqual(M.flags(near, {params, list: [near], sentences: S}), []);
});

test('提醒：缺译文只在要译文时提；落在句中分起点和终点', () => {
  const holes = S.map((s, i) => (i === 6 ? Object.assign({}, s, {trans: ''}) : s));
  const seg = Object.assign({id: 'a', on: true}, M.rangeOf(holes, 4, 14));
  assert.deepEqual(M.flags(seg, {params: {length: 'mid', tracks: 'both'}, list: [seg], sentences: holes}).map((f) => f.k), ['untranslated']);
  assert.deepEqual(M.flags(seg, {params: {length: 'mid', tracks: 'orig'}, list: [seg], sentences: holes}), []);
  const loose = M.manualCandidate(S, {range: {start: S[4].start + 1, end: S[14].end - 1}});
  assert.deepEqual(loose.loose, {start: true, end: true});
  assert.deepEqual([loose.from, loose.to], [4, 14]);
  const fl = M.flags(loose, {params: {length: 'mid', tracks: 'orig'}, list: [loose], sentences: S}).map((f) => f.text);
  assert.deepEqual(fl, ['起点落在一句话中间', '终点落在一句话中间']);
  // 挪过的那一端回到句子边界，另一端不动
  const fixed = M.nudge(S, loose, 'start', -1);
  assert.deepEqual([fixed.start, fixed.end, fixed.loose.start, fixed.loose.end], [S[3].start, loose.end, false, true]);
});

test('演示候选：多找两段，先勾要的条数，勾上的互不重叠、不含要靠前文的', () => {
  const list = M.demoCandidates(S, {count: 3, length: 'mid'}, {children: []});
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((c) => c.start), list.map((c) => c.start).slice().sort((a, b) => a - b), '按原片先后');
  const on = M.chosen(list);
  assert.equal(on.length, 3);
  on.forEach((a) => on.forEach((b) => { if (a !== b) assert.ok(M.overlapSec(a, b) < 1); }));
  assert.ok(on.every((c) => !c.weak));
  on.forEach((c) => assert.deepEqual(M.flags(c, {params: {length: 'mid', tracks: 'both'}, list, children: [], sentences: S}), [], c.title));
  assert.match(M.pickHeadline(list, true), /^找到 5 段，先替你选了 3 段 · 合计 \d+:\d\d$/);
  assert.equal(M.createLabel(3), '创建 3 支短视频');
});

test('演示候选：切过的那一段开着「不再找」时不出现，关掉后出现但不替你勾', () => {
  const kids = [child('p5', 37, 53)];
  const skip = M.demoCandidates(S, {count: 3, skipDone: true}, {children: kids});
  assert.ok(skip.every((c) => !M.doneBy(c, kids)));
  assert.equal(M.chosen(skip).length, 3);
  const keep = M.demoCandidates(S, {count: 3, skipDone: false}, {children: kids});
  const done = keep.filter((c) => M.doneBy(c, kids));
  assert.equal(done.length, 1);
  assert.equal(done[0].on, false);
  assert.equal(M.chosen(keep).length, 3);
});

test('演示候选：只在一章里找时起点都在这一章，不跨章就收在章尾之前', () => {
  const scope = {start: 95, end: 158};
  const list = M.demoCandidates(S, {count: 2}, {scope, children: []});
  assert.ok(list.length >= 1);
  list.forEach((c) => { assert.ok(c.start >= 95 - 0.02 && c.end <= 158 + 0.02, c.title); });
});

test('再找几段：只给没出现过的，不勾；找完了给空表', () => {
  const list = M.demoCandidates(S, {count: 3}, {children: []});
  const more = M.demoMore(S, {count: 3}, list, {children: []});
  assert.equal(more.length, 2);
  assert.ok(more.every((c) => !c.on && !list.some((x) => x.id === c.id)));
  assert.deepEqual(M.demoMore(S, {count: 3}, list.concat(more), {children: []}), []);
});

test('自己加一段：从播放头那一句起，凑到这一档的中间长度', () => {
  const c = M.manualCandidate(S, {t: S[20].start + 1, params: {length: 'mid'}});
  assert.equal(c.from, 20);
  assert.ok(c.end - c.start >= 45 && c.end - c.start < 50);
  assert.equal(c.on, true);
});

test('创建：标题去重；项目记录引用同一份原片并记下起止', () => {
  assert.equal(M.childTitle('上传本身就是一个决定', []), '上传本身就是一个决定');
  assert.equal(M.childTitle('A', ['A', 'A 2']), 'A 3');
  assert.equal(M.childTitle('  ', []), '未命名短视频');
  const seg = Object.assign({id: 'a', focusX: 32}, M.rangeOf(S, 4, 13));
  const p = M.childProject({id: 'ps1', parent, seg, title: '为什么做本机', params: {focus: 'manual'}});
  assert.deepEqual(p.origin, {project: 'p1', in: S[4].start, out: S[13].end});
  assert.deepEqual([p.delivery, p.ratio, p.bare], ['shorts', '9:16', true]);
  assert.equal(p.src.name, parent.src.name);
  assert.notEqual(p.src, parent.src);
  assert.equal(p.duration, +(S[13].end - S[4].start).toFixed(2));
  assert.equal(p.cut.focusX, 32);
  assert.equal(p.meta.cues, 10);
  assert.equal(M.checkLine(seg).text, '能查的都过了');
  assert.equal(M.checkLine({start: 0, end: 62}).text, '1 项要看一眼 · 时长 62 秒');
});

test('交给 Agent 的附加句：参数都在，候选写进候选库、确认前不创建', () => {
  const x = M.agentExtra({count: 4, length: 'short', note: '只要讲成本的', skipDone: true, hook: true}, {children: 2, scopeName: '产品演示'});
  assert.match(x[0], /^要 4 支，每支 15–30 秒/);
  assert.ok(x.includes('只在「产品演示」里找'));
  assert.ok(x.includes('我想要的：只要讲成本的'));
  assert.ok(x.includes('已经切过的 2 支不用再找'));
  assert.match(x[x.length - 1], /候选库.*不要创建视频/);
  const bare = M.agentExtra({note: '', hook: false}, {});
  assert.equal(bare.length, 2);
});

test('列表副题：跟着会话走，切过的补一句', () => {
  const list = M.demoCandidates(S, {count: 3}, {children: []});
  assert.equal(M.listStatus(null, '挑几段', 0), '挑几段');
  assert.equal(M.listStatus({phase: 'setup'}, '挑几段', 2), '挑几段 · 已有 2 支');
  assert.equal(M.listStatus({phase: 'finding', pct: 44.6}, 'x', 0), '正在找片段 · 45%');
  assert.equal(M.listStatus({phase: 'review', list}, 'x', 0), '找到 5 段 · 等你挑');
  assert.equal(M.listStatus({phase: 'creating', pct: 60, list}, 'x', 0), '正在创建 3 支 · 60%');
  assert.equal(M.listStatus({phase: 'done', made: [1, 2, 3]}, 'x', 0), '已创建 3 支');
  assert.equal(M.stageAt(M.FIND_STAGES, 0), 0);
  assert.equal(M.stageAt(M.FIND_STAGES, 100), 2);
});

/* ---------- 短视频项目里的「原片」卡 ---------- */
const el = (id, start, end, srcStart) => ({id, kind: 'video', fromSource: true, start, end, srcStart});

test('片段：由时间轴上绑着原片的视频元素派生，别的元素不算', () => {
  const ps = M.piecesOf([el('b', 30, 40, S[20].start), el('a', 0, 30, S[4].start),
    {id: 't', kind: 'text', start: 0, end: 5}, {id: 'v', kind: 'video', start: 0, end: 5}]);
  assert.deepEqual(ps.map((p) => p.id), ['a', 'b']);
  assert.equal(ps[0].in, S[4].start);
  assert.equal(ps[0].out, S[4].start + 30);
  assert.deepEqual(M.usedFrom(ps)[1], {in: +S[20].start.toFixed(2), out: +(S[20].start + 10).toFixed(2)});
});

test('多留一句：前面取上一句、后面取下一句，到原片头尾给 null', () => {
  const piece = {id: 'a', start: 0, end: S[13].end - S[4].start, in: S[4].start, out: S[13].end};
  const before = M.extendRange(S, piece, 'before');
  assert.deepEqual([before.in, before.out, before.at, before.sentence.id], [S[3].start, S[4].start, 0, 'g4']);
  const after = M.extendRange(S, piece, 'after');
  assert.deepEqual([after.in, after.out, after.at, after.sentence.id], [S[13].end, S[14].end, piece.end, 'g15']);
  assert.equal(M.extendRange(S, {in: 0, out: 10, start: 0, end: 10}, 'before'), null);
  assert.equal(M.extendRange(S, {in: 190, out: DUR, start: 0, end: 16}, 'after'), null);
  // 片段的边落在句中：先补齐那半句
  const mid = M.extendRange(S, {in: S[4].start + 1, out: S[6].end, start: 0, end: 9}, 'before');
  assert.deepEqual([mid.in, mid.out], [S[4].start, S[4].start + 1]);
});

test('多留一句：这一段变长，后面的片段与字幕顺延，新字幕补在缝上', () => {
  const a = {id: 'a', start: 0, end: S[6].end - S[4].start, in: S[4].start, out: S[6].end};
  const b = {id: 'b', start: a.end, end: a.end + (S[21].end - S[20].start), in: S[20].start, out: S[21].end};
  const cues = M.cuesIn(S, a, a.start).concat(M.cuesIn(S, b, b.start));
  assert.deepEqual(cues.map((c) => c.id), ['g5', 'g6', 'g7', 'g21', 'g22']);
  assert.equal(cues[0].start, 0);

  const r = M.extendRange(S, a, 'after');
  const d = r.out - r.in;
  const patches = M.extendPatches([a, b], 'a', 'after', r);
  assert.deepEqual(patches.map((p) => p.id), ['a', 'b']);
  assert.equal(patches[0].end, +(a.end + d).toFixed(2));
  assert.equal(patches[0].in, a.in);
  assert.equal(patches[1].start, +(b.start + d).toFixed(2));
  const next = M.insertCues(cues, S, r, r.at);
  assert.deepEqual(next.map((c) => c.id), ['g5', 'g6', 'g7', 'g8', 'g21', 'g22']);
  assert.equal(next[3].start, +a.end.toFixed(2));
  assert.equal(next[4].start, +(cues[3].start + d).toFixed(2));

  const rb = M.extendRange(S, a, 'before');
  const pb = M.extendPatches([a, b], 'a', 'before', rb);
  assert.equal(pb[0].in, S[3].start);
  assert.equal(pb[0].start, 0);
  const nb = M.insertCues(cues, S, rb, rb.at);
  assert.deepEqual(nb.map((c) => c.id), ['g4', 'g5', 'g6', 'g7', 'g21', 'g22']);
  assert.equal(nb[1].start, +(rb.out - rb.in).toFixed(2));
});

test('再加一段：放在最后或播放头所在的那条缝；同一句用第二次 id 不撞', () => {
  const a = {id: 'a', start: 0, end: 10, in: S[4].start, out: S[4].start + 10};
  const b = {id: 'b', start: 10, end: 25, in: S[20].start, out: S[20].start + 15};
  assert.equal(M.insertPoint([a, b], 'end', 3), 25);
  assert.equal(M.insertPoint([a, b], 'playhead', 3), 10, '压在片段中间：放到这一段后面');
  assert.equal(M.insertPoint([a, b], 'playhead', 0), 0);
  assert.equal(M.insertPoint([a, b], 'playhead', 40), 25);
  assert.deepEqual(M.shiftPatches([a, b], 10, 5).map((p) => [p.id, p.start, p.end]), [['b', 15, 30]]);
  const sel = M.selection(S, 8, 5);
  assert.deepEqual([sel.from, sel.to, sel.count], [5, 8, 4]);
  assert.equal(sel.text, `已选 4 句 · ${M.secs(S[8].end - S[5].start)}`);
  assert.equal(M.selection(S, null, null), null);
  assert.equal(M.selection(S, 7, null).count, 1);
  const cues = M.cuesIn(S, {in: S[5].start, out: S[8].end}, 0);
  const again = M.insertCues(cues, S, {in: S[5].start, out: S[6].end}, cues[cues.length - 1].end, 'r2');
  assert.equal(new Set(again.map((c) => c.id)).size, again.length);
  assert.ok(again.some((c) => c.id === 'g6@r2' && c.srcId === 'g6'));
});

test('已用的句子与原片条色块', () => {
  const used = M.usedIds(S, [{in: S[4].start, out: S[6].end}, {in: S[20].start + 0.2, out: S[20].end}]);
  assert.deepEqual([...used], ['g5', 'g6', 'g7', 'g21']);
  const b = M.bar([{start: 0, end: 103}, {start: 200, end: 300}], DUR);
  assert.deepEqual(b[0], {left: 0, width: 50});
  assert.ok(Math.abs(b[1].left + b[1].width - 100) < 0.01);
});

test('取景：取景窗大小按原片画幅，中心夹在原片里，偏多少用原片宽的百分比说', () => {
  const size = M.focusSize(16 / 9);
  assert.ok(Math.abs(size.w - 0.3164) < 0.001);
  assert.equal(size.h, 1);
  assert.deepEqual(M.focusSize(9 / 16), {w: 1, h: 1});
  assert.ok(M.focusSize(0.5).h < 1);
  assert.ok(Math.abs(M.clampFocus(0, 16 / 9) - size.w / 2) < 1e-9);
  assert.ok(Math.abs(M.clampFocus(1, 16 / 9) - (1 - size.w / 2)) < 1e-9);
  assert.equal(M.clampFocus(null, 16 / 9), 0.5);
  assert.equal(M.focusText(null), '居中');
  assert.equal(M.focusText(0.5), '居中');
  assert.equal(M.focusText(0.32), '偏左 18%');
  assert.equal(M.focusText(0.56), '偏右 6%');
});

test('focusAt / speakerMap：跟着说话的人按这一句是谁说的取位置，认不出退到正中；自己定的用那一段的位置', () => {
  const subjects = [{id: 'p1', kind: 'person', x: 0.3}, {id: 'b', kind: 'board', x: 0.9}, {id: 'p2', kind: 'person', x: 0.7}];
  const lines = [{sp: 'a'}, {sp: 'b'}, {sp: 'a'}, {sp: 'c'}];
  const map = M.speakerMap(lines, subjects);
  assert.deepEqual(map, {a: 0.3, b: 0.7, c: 0.3});
  assert.deepEqual(M.speakerMap(lines, []), {});
  assert.equal(M.focusAt({focus: 'speaker'}, null, {sp: 'b'}, map, 16 / 9), 0.7);
  assert.equal(M.focusAt({focus: 'speaker'}, null, {sp: 'zz'}, map, 16 / 9), 0.5);
  assert.equal(M.focusAt({focus: 'center'}, {focusX: 0.2}, {sp: 'b'}, map, 16 / 9), 0.5);
  assert.equal(M.focusAt({focus: 'manual'}, {focusX: 0.4}, null, map, 16 / 9), 0.4);
  assert.equal(M.focusAt({focus: 'manual'}, {}, null, map, 16 / 9), 0.5);
});

test('contextFocus: pauses retain a person, openings use context, no speech still frames a visible person', () => {
  const lines = [{start: 3, end: 5, sp: 'guest'}, {start: 9, end: 11, sp: 'host'}];
  const map = {guest: 0.75, host: 0.2};
  const people = [{kind: 'person', x: 0.2}, {kind: 'person', x: 0.75}];
  assert.equal(M.contextFocus(lines, 0, map, people), 0.75);
  assert.equal(M.contextFocus(lines, 8, map, people), 0.75);
  assert.equal(M.contextFocus(lines, 12, map, people), 0.2);
  assert.equal(M.contextFocus([], 0, {}, people), 0.2);
  assert.equal(M.contextFocus([], 0, {}, []), null);
  assert.equal(M.focusAt({focus: 'speaker'}, null, null, map, 16 / 9,
    M.contextFocus(lines, 8, map, people)), 0.75);
});

test('review history groups a completed trim and preserves other candidate fields', () => {
  const before={id:'a',start:10,end:40,from:1,to:3}, after={...before,start:0,from:0};
  let s={list:[after],...M.reviewRecord({},before,after)};
  s.list[0]={...after,title:'Changed title',on:true};
  s={...s,...M.reviewStep(s,false)};
  assert.equal(s.list[0].start,10); assert.equal(s.list[0].title,'Changed title'); assert.equal(s.list[0].on,true);
  s={...s,...M.reviewStep(s,true)}; assert.equal(s.list[0].start,0);
  s.list[0]={...s.list[0],end:55}; assert.equal(M.reviewCanStep(s,false),false);
});

test('review subtitles use cue intervals, including gaps and separate translation timing', () => {
  const orig=[{start:0,end:1,text:'First'},{start:1,end:2,text:'Second'}];
  const trans=[{start:0,end:1.5,text:'Premier'},{start:1.5,end:2,text:'Deuxième'}];
  assert.equal(M.reviewCueAt(orig,1.25).text,'Second');
  assert.equal(M.reviewCueAt(trans,1.25).text,'Premier');
  assert.equal(M.reviewCueAt(orig,3),null);
  assert.equal(M.reviewCueAt([],0),null);
});

test('direct boundary edits reject inverted or out-of-source times', () => {
  const lines=Array.from({length:5},(_,i)=>({start:i*10,end:(i+1)*10}));
  const c={id:'a',start:10,end:40,from:1,to:3};
  const next=M.setReviewEdge(lines,c,'start',12.5,50);
  assert.equal(next.start,12.5); assert.equal(next.end,40); assert.equal(next.loose.start,true);
  for(const t of [-1,40,NaN,60]) assert.equal(M.setReviewEdge(lines,c,'start',t,50),null);
});

test('captionSpec：短视频字幕落在安全框里，沿用项目样式的会压到底部遮挡区；画哪几行跟着轨集', () => {
  const safe = {top: 8, right: 18, bottom: 24, side: 6};
  const line = {text: 'orig', trans: 'translated'};
  const a = M.captionSpec({style: 'shorts', tracks: 'both'}, line, safe);
  assert.deepEqual(a.lines.map((l) => l.k), ['orig', 'trans']);
  assert.equal(a.bottom, 74);
  assert.equal(a.width, 60);
  assert.equal(a.blocked, false);
  const b = M.captionSpec({style: 'project', tracks: 'trans'}, line, safe);
  assert.deepEqual(b.lines.map((l) => l.k), ['trans']);
  assert.equal(b.blocked, true);
  assert.deepEqual(M.captionSpec({tracks: 'both'}, {text: 'only'}, safe).lines.map((l) => l.k), ['orig']);
  assert.deepEqual(M.captionSpec({}, null, safe).lines, []);
});

test('pieceRows / ripplePatches：来源卡逐段一行，到原片头尾就不能再多留；别的元素跟着顺延', () => {
  const el = (id, start, end, src) => ({id, kind: 'video', fromSource: true, start, end, srcStart: src});
  const ps = M.piecesOf([el('a', 0, +(S[2].end - S[0].start).toFixed(2), S[0].start),
    el('b', 10, +(10 + S[S.length - 1].end - S[S.length - 2].start).toFixed(2), S[S.length - 2].start)]);
  const rows = M.pieceRows(S, ps);
  assert.deepEqual(rows.map((r) => r.n), [1, 2]);
  assert.equal(rows[0].hook, S[0].text);
  assert.equal(rows[0].before, null);
  assert.ok(rows[0].after);
  assert.equal(rows[1].after, null);
  assert.equal(rows[0].span, M.spanText({start: ps[0].in, end: ps[0].out}));
  const moved = M.ripplePatches([
    {id: 'a', fromSource: true, start: 0, end: 8}, {id: 't1', start: 2, end: 4}, {id: 't2', start: 9, end: 12},
    {id: 'bar', start: 0, end: 20, endAnchor: true}, {id: 'whole'}, {id: 'skip', start: 10, end: 11},
  ], 8, 3, ['skip']);
  assert.deepEqual(moved, [{id: 't2', start: 12, end: 15}]);
});

test('sourceRows / rowWindow / sameUsed：章节头也算一行；窗口只取看得见的行；现状没变就不写回', () => {
  const chapters = [{id: 'c2', title: '第二章', start: S[3].start}, {id: 'c1', title: '第一章', start: 0}];
  const rows = M.sourceRows(S, chapters);
  assert.equal(rows.length, S.length + 2);
  assert.deepEqual(rows[0], {head: true, id: 'h:c1', title: '第一章', at: 0});
  assert.equal(rows[1].index, 0);
  assert.equal(rows[4].head, true);
  assert.equal(rows[5].sentence, S[3]);
  assert.equal(M.sourceRows(S, []).length, S.length);
  const w = M.rowWindow(10000, 3200, 320);
  assert.deepEqual(w, {start: 96, end: 114, height: 10000 * M.ROW_H});
  assert.deepEqual(M.rowWindow(3, 0, 320), {start: 0, end: 3, height: 3 * M.ROW_H});
  const proj = {origin: {project: 'p', in: 10, out: 20}};
  assert.equal(M.sameUsed(proj, [{in: 10, out: 20}]), true);
  assert.equal(M.sameUsed(proj, [{in: 10, out: 22}]), false);
  assert.equal(M.sameUsed({...proj, used: [{in: 8, out: 20}, {in: 40, out: 50}]}, [{in: 8, out: 20}, {in: 40, out: 50}]), true);
});

test('insertCues：插在中间时后面的字幕整体顺延，前面的不动', () => {
  const base = M.insertCues(M.insertCues([], S, {in: S[0].start, out: S[1].end}, 0), S, {in: S[6].start, out: S[7].end}, +(S[1].end - S[0].start).toFixed(2));
  const at = +(S[1].end - S[0].start).toFixed(2);
  const r = {in: S[3].start, out: S[4].end};
  const d = r.out - r.in;
  const next = M.insertCues(base, S, r, at, 'x1');
  assert.deepEqual(next.map((c) => c.srcId), [S[0].id, S[1].id, S[3].id, S[4].id, S[6].id, S[7].id]);
  assert.equal(next[0].start, base[0].start);
  assert.ok(Math.abs(next[4].start - (base[2].start + d)) < 0.011);
  assert.ok(Math.abs(next[5].end - (base[3].end + d)) < 0.011);
  for (let i = 1; i < next.length; i += 1) assert.ok(next[i].start >= next[i - 1].end - 0.011);
});

test('openTracks：按创建时选的轨留，选了短视频字幕就按安全区几何落位；没有 cut 原样返回', () => {
  const tracks = [
    {id: 'en', role: 'translation', size: 44, y: 86, valign: 'bottom'},
    {id: 'zh', role: 'source', size: 32, y: 93, valign: 'bottom'},
  ];
  const layout = (ts) => Object.fromEntries(ts.map((t, i) => [t.id, {y: 74 - i * 8, width: 60, size: 40}]));
  assert.equal(M.openTracks(null, tracks, layout), tracks);
  assert.deepEqual(M.openTracks({tracks: 'orig', style: 'follow'}, tracks, layout), [tracks[1]]);
  assert.deepEqual(M.openTracks({tracks: 'trans', style: 'follow'}, tracks, layout).map((t) => t.id), ['en']);
  const both = M.openTracks({tracks: 'both', style: 'shorts'}, tracks, layout);
  assert.deepEqual(both.map((t) => [t.id, t.y, t.width]), [['en', 74, 60], ['zh', 66, 60]]);
  assert.equal(both[1].role, 'source');
  assert.equal(tracks[0].y, 86);
  const one = M.openTracks({tracks: 'orig', style: 'shorts'}, tracks, layout);
  assert.deepEqual(one.map((t) => [t.id, t.y]), [['zh', 74]]);
  assert.deepEqual(M.openTracks({tracks: 'both', style: 'shorts'}, tracks, null), tracks);
});

test('切出的短视频一组：组头数支数与合计，行按现状写；剪过的认得出来', () => {
  const a = child('k1', 4, 13, {cut: {focus: 'speaker', tracks: 'both', style: 'shorts'}, modified: '昨天', hue: 200});
  const b = child('k2', 37, 53, {cut: {focus: 'center', tracks: 'orig', style: 'shorts'},
    used: [{in: S[37].start, out: S[54].end}]});
  const c = child('k3', 56, 61, {used: [{in: S[56].start, out: S[61].end}, {in: S[20].start, out: S[22].end}]});
  const kids = [a, b, c];
  const head = M.madeHead(kids);
  assert.equal(head.count, 3);
  assert.match(head.text, /^3 支 · 合计 \d+:\d\d$/);
  assert.equal(M.madeHead([]).text, '0 支 · 合计 0:00');
  const rows = M.madeRows(kids);
  assert.deepEqual(rows.map((r) => [r.id, r.n, r.edited]), [['k1', 1, false], ['k2', 2, true], ['k3', 3, true]]);
  assert.equal(rows[0].span, `${M.mmss(S[4].start)} – ${M.mmss(S[13].end)}`);
  assert.equal(rows[0].cut, '跟着说话的人 · 原文 + 译文');
  assert.equal(rows[1].cut, '居中 · 只要原文');
  assert.equal(rows[1].len, M.secs(S[54].end - S[37].start));
  assert.equal(rows[2].cut, '');
  assert.match(rows[2].span, /^2 段 · 从 \d+:\d\d 起$/);
  assert.equal(rows[0].at, S[4].start);
  const bar = M.madeBar(kids, DUR);
  assert.deepEqual(bar.map((x) => x.id), ['k1', 'k2', 'k3', 'k3']);
  assert.ok(bar.every((x) => x.left >= 0 && x.left + x.width <= 100.001));
  assert.deepEqual(M.madeBar(kids, 0), []);
  assert.deepEqual(M.rowWindow(3, 0, 256, M.MADE_ROW_H), {start: 0, end: 3, height: 3 * M.MADE_ROW_H});
  assert.equal(M.rowWindow(500, 6400, 256, M.MADE_ROW_H).start, 96);
});

test('调整后再生成：现状连着就带现状，剪成几段带切出时的那一段；不拿自己当已切过', () => {
  const kid = child('k2', 37, 53, {title: '字幕为什么是单独的一层', cut: {focus: 'manual', focusX: 0.62, tracks: 'trans', style: 'project'},
    used: [{in: S[37].start, out: S[54].end}]});
  const c = M.redoCandidate(S, kid);
  assert.deepEqual([c.from, c.to, c.start, c.end], [37, 54, S[37].start, S[54].end]);
  assert.deepEqual([c.id, c.redoOf, c.added, c.on, c.title, c.focusX], ['sc-redo-k2', 'k2', 'redo', true, '字幕为什么是单独的一层 · 第 2 版', 0.62]);
  assert.deepEqual(c.loose, {start: false, end: false});
  const flags = M.flags(c, {params: {length: 'mid', tracks: 'orig'}, list: [c], children: [kid], sentences: S});
  assert.deepEqual(flags.map((f) => f.k), ['redo']);
  assert.equal(flags[0].text, '重做 · 另建一支，原来那支不动');
  assert.match(c.reason, /^「字幕为什么是单独的一层」现在的起止$/);
  // 别的短视频切过同一段，照样提醒
  const other = child('k9', 37, 53);
  assert.deepEqual(M.flags(c, {params: {length: 'mid', tracks: 'orig'}, list: [c], children: [kid, other], sentences: S}).map((f) => f.k), ['redo', 'done']);

  const split = child('k3', 56, 61, {used: [{in: S[56].start, out: S[61].end}, {in: S[20].start, out: S[22].end}]});
  const d = M.redoCandidate(S, split);
  assert.deepEqual([d.from, d.to], [56, 61]);
  assert.match(d.reason, /切出时的起止/);

  const dragged = child('k4', 4, 13, {used: [{in: S[4].start + 0.8, out: S[13].end}]});
  assert.deepEqual(M.redoCandidate(S, dragged).loose, {start: true, end: false});
  assert.equal(M.redoCandidate(S, {id: 'x'}), null);
  assert.equal(M.redoCandidate([], kid), null);
  assert.equal(M.redoTitle('字幕为什么是单独的一层', ['字幕为什么是单独的一层 · 第 2 版']), '字幕为什么是单独的一层 · 第 3 版');
  assert.equal(M.redoTitle('字幕为什么是单独的一层 · 第 2 版', ['字幕为什么是单独的一层 · 第 2 版']), '字幕为什么是单独的一层 · 第 3 版');
  assert.equal(M.redoCandidate(S, kid, ['字幕为什么是单独的一层 · 第 2 版']).title, '字幕为什么是单独的一层 · 第 3 版');
  assert.equal(M.redoTitle('', []), '未命名短视频 · 第 2 版');
});

test('重做的设置与落点：那一支的取景与字幕盖在现有设置上；正在跑就等，有候选就接在后面', () => {
  const kid = child('k2', 37, 53, {cut: {focus: 'manual', focusX: 0.62, tracks: 'trans', style: 'project'}});
  const p = M.redoParams(kid, {count: 5, length: 'short', focus: 'center'}, {hasTrans: true, portrait: false, children: 1});
  assert.deepEqual([p.count, p.length, p.focus, p.tracks, p.style], [5, 'short', 'manual', 'trans', 'project']);
  assert.equal(M.redoParams(kid, {}, {hasTrans: false, portrait: true, children: 1}).tracks, 'orig');
  assert.equal(M.redoParams(kid, {}, {hasTrans: false, portrait: true, children: 1}).focus, 'center');
  assert.equal(M.redoParams(child('k5', 4, 13), {}, {hasTrans: true}).focus, 'speaker');

  const cand = M.redoCandidate(S, kid);
  assert.equal(M.redoPlan(null), 'fresh');
  assert.equal(M.redoPlan({phase: 'setup', list: []}), 'fresh');
  assert.equal(M.redoPlan({phase: 'finding', list: []}), 'busy');
  assert.equal(M.redoPlan({phase: 'creating', list: [cand]}), 'busy');
  assert.equal(M.redoPlan({phase: 'review', list: [cand]}), 'append');
  assert.equal(M.redoPlan({phase: 'done', list: [Object.assign({}, cand, {removed: true})]}), 'fresh');
  // 手里只剩创建掉的，不算有候选
  const spent = Object.assign({}, cand, {on: false, made: true});
  assert.equal(M.redoPlan({phase: 'done', list: [spent]}), 'fresh');

  // 接在后面：别的一条都没勾，设置跟这一支原来的走；有勾上的就不动
  const found3 = M.demoCandidates(S, {count: 3}, {children: []});
  const base = M.normalize({focus: 'center', tracks: 'orig'}, {hasTrans: true});
  const facts = {hasTrans: true, portrait: false, children: 1};
  const off = M.redoAppend({list: found3.map((x) => Object.assign({}, x, {on: false})).concat([spent]), params: base, facts}, kid, cand);
  assert.deepEqual([off.params.focus, off.params.tracks, off.kept], ['manual', 'trans', false]);
  assert.equal(off.list.length, found3.length + 1);
  assert.equal(off.list[off.list.length - 1].id, cand.id);
  const held = M.redoAppend({list: found3.map((x, i) => Object.assign({}, x, {on: i === 0})), params: base, facts}, kid, cand);
  assert.deepEqual([held.params.focus, held.params.tracks, held.kept], ['center', 'orig', true]);
  const same = M.redoAppend({list: found3.map((x, i) => Object.assign({}, x, {on: i === 0})), params: M.redoParams(kid, base, facts), facts}, kid, cand);
  assert.equal(same.kept, false);
  assert.match(M.pickLead([cand, Object.assign({}, cand, {id: 'sc-redo-k9', on: false})], false).head, /^重做 2 支，勾了 1 支 · 合计/);

  assert.match(M.pickLead([cand], false).head, /^重做 1 支 · 合计 \d+:\d\d$/);
  assert.equal(M.pickLead([cand], false).redo, true);
  const found = M.demoCandidates(S, {count: 3}, {children: []});
  assert.equal(M.pickLead(found.concat([cand]), true).head, M.pickHeadline(found.concat([cand]), true));
  assert.equal(M.pickLead(found.concat([cand]), true).redo, false);
});
