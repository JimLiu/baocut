const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-video-edit.js');
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
/** 用到的几段 → 片段外的剪口（`[0, DUR]` 里扣掉这几段）。 */
const outsideOf = (used) => {
  const r = used.slice().sort((x, y) => x.start - y.start);
  const out = [];
  let a = 0;
  r.forEach((u, i) => { if (u.start > a) out.push({id: 'o' + i, start: a, end: u.start, kind: 'outside', state: 'cut', by: 'agent'}); a = Math.max(a, u.end); });
  if (a < DUR) out.push({id: 'o-end', start: a, end: DUR, kind: 'outside', state: 'cut', by: 'agent'});
  return out;
};
/** `extra.used`（`[{start, end}]`）写成这一支的剪口：子视频的现状只存在剪口里。 */
const child = (id, from, to, extra) => {
  const e = Object.assign({}, extra);
  const used = e.used;
  delete e.used;
  return Object.assign({id, title: '短视频切片 · ' + id,
    origin: {project: 'p1', in: S[from].start, out: S[to].end, dur: DUR}}, used ? {cuts: outsideOf(used)} : {}, e);
};

test('参数：缺省值、条数夹在 1–10、时长档不设上限、画幅缺省 9:16', () => {
  assert.equal(M.DEFAULTS.count, 'auto', '几支缺省交给 Agent 按话题定');
  assert.equal(M.DEFAULTS.length, 'auto', '多长缺省交给 Agent 按话题定');
  assert.equal(M.DEFAULTS.focus, 'auto');
  assert.equal(M.DEFAULTS.ratio, '9:16');
  assert.equal(M.FOCUS[0].id, 'speaker');
  assert.equal(M.FOCUS[0].off, '转写里还没分出说话人 · 先用「识别说话人」');
  assert.equal(M.clampCount(0), 1);
  assert.equal(M.clampCount(99), 10);
  assert.equal(M.clampCount('x'), 'auto');
  assert.equal(M.clampCount('auto'), 'auto');
  assert.deepEqual(M.LENGTHS.map((l) => l.id), ['auto', 'short', 'mid', 'long', 'xl', 'custom']);
  assert.deepEqual(M.LENGTHS.filter((l) => l.id !== 'custom' && l.id !== 'auto').map((l) => [l.min, l.max]), [[15, 30], [30, 60], [60, 90], [60, 180]]);
  assert.equal(M.lengthOf('nope').id, 'auto');
  assert.equal(M.lengthOf('xl').name, '1–3 分钟');
  assert.deepEqual(M.RATIOS.map((r) => r.id), ['9:16', '1:1', 'source']);
  assert.equal(M.PLATFORM_MAX, undefined);
  assert.equal(M.lengthNote, undefined);
  assert.equal(M.summaryLine({count: 4, length: 'short', focus: 'auto'}), '4 支 · 每支 15–30 秒 · 9:16 · 自动');
  assert.equal(M.summaryLine({count: 2, length: 'xl', ratio: 'source'}), '2 支 · 每支 1–3 分钟 · 保留原画幅');
});

test('自定义时长：两头夹在 1–600 秒，下限比上限小，反了就对调', () => {
  assert.deepEqual(M.lengthRange({length: 'custom', lenMin: 20, lenMax: 45}), {id: 'custom', min: 20, max: 45, name: '20–45 秒'});
  assert.deepEqual([M.lengthRange({length: 'custom', lenMin: 0, lenMax: 900}).min, M.lengthRange({length: 'custom', lenMin: 0, lenMax: 900}).max], [1, 600]);
  assert.deepEqual([M.lengthRange({length: 'custom', lenMin: 90, lenMax: 40}).min, M.lengthRange({length: 'custom', lenMin: 90, lenMax: 40}).max], [40, 90]);
  assert.deepEqual([M.lengthRange({length: 'custom', lenMin: 600, lenMax: 600}).min, M.lengthRange({length: 'custom', lenMin: 600, lenMax: 600}).max], [599, 600]);
  assert.deepEqual([M.lengthRange({length: 'custom', lenMin: 'x', lenMax: ''}).min, M.lengthRange({length: 'custom', lenMin: 'x', lenMax: ''}).max], [30, 60]);
  const p = M.normalize({length: 'custom', lenMin: 300, lenMax: 120}, {hasTrans: true});
  assert.deepEqual([p.lenMin, p.lenMax], [120, 300]);
  assert.equal(M.summaryLine(p), '几支按话题定 · 每支 120–300 秒 · 9:16 · 自动');
  assert.equal(M.normalize({ratio: 'nope'}, {}).ratio, '9:16');
});

test('参数落到项目上：没有译文只有原文；竖屏原片不取景；没切过时不记「不再找」', () => {
  const a = M.normalize({tracks: 'both', focus: 'manual', skipDone: false}, {hasTrans: false, portrait: true, children: 0});
  assert.equal(a.tracks, 'orig');
  assert.equal(a.focus, 'auto');
  assert.equal(a.skipDone, true);
  const b = M.normalize({tracks: 'trans', focus: 'manual', skipDone: false}, {hasTrans: true, portrait: false, children: 2});
  assert.deepEqual([b.tracks, b.focus, b.skipDone], ['trans', 'manual', false]);
});

test('取景：分不出说话人时缺省自动、跟着说话的人选不了；旧版的居中不再单列，带进来落回缺省；竖屏原片仍不取景', () => {
  const ctx = {hasTrans: true, portrait: false, children: 0};
  assert.deepEqual(M.FOCUS.map((f) => f.id), ['speaker', 'auto', 'manual']);
  assert.equal(M.normalize({}, ctx).focus, 'auto');
  assert.equal(M.normalize({focus: 'speaker'}, ctx).focus, 'auto');
  assert.equal(M.normalize({focus: 'speaker'}, Object.assign({}, ctx, {speakers: 1})).focus, 'auto', '一个说话人不算分出来');
  assert.equal(M.focusOpen(M.focusOf('speaker'), ctx), false);
  assert.equal(M.focusOpen(M.focusOf('auto'), ctx), true);
  assert.equal(M.normalize({focus: 'center'}, ctx).focus, 'auto');
  assert.equal(M.normalize({focus: 'nope'}, ctx).focus, 'auto');
  assert.equal(M.normalize({focus: 'manual'}, ctx).focus, 'manual');
  assert.equal(M.normalize({focus: 'manual'}, Object.assign({}, ctx, {portrait: true})).focus, 'auto');
  assert.equal(M.focusOf('nope').id, 'auto');
  assert.equal(M.summaryLine(M.normalize({}, ctx)), '按话题定几支、多长 · 9:16 · 自动');
  assert.equal(M.summaryLine(M.normalize({count: 3, length: 'mid'}, ctx)), '3 支 · 每支 30–60 秒 · 9:16 · 自动');
});

test('取景：转写里分出 2 个以上说话人时缺省跟着说话的人，可以改成别的；分屏开关跟着它也出现', () => {
  const ctx = {hasTrans: true, portrait: false, children: 0, speakers: 3};
  assert.equal(M.focusOpen(M.focusOf('speaker'), ctx), true);
  assert.equal(M.normalize({}, ctx).focus, 'speaker');
  assert.equal(M.normalize({focus: 'nope'}, ctx).focus, 'speaker');
  assert.equal(M.normalize({focus: 'auto'}, ctx).focus, 'auto');
  assert.equal(M.normalize({focus: 'manual'}, ctx).focus, 'manual');
  assert.equal(M.normalize({}, Object.assign({}, ctx, {portrait: true})).focus, 'auto', '竖屏原片不取景');
  assert.deepEqual(['speaker', 'auto', 'manual'].map(M.splitApplies), [true, true, false]);
  const x = M.agentExtra({focus: 'speaker'});
  assert.ok(x.includes('画幅 9:16，取景跟着说话的人：有近景与全景来回切时按镜头取景；只有一个全景机位时用 videos_shots 的 by speaker 按说话人切段，谁说话对准谁'));
  assert.ok(x.includes(M.SPLIT.promptOn));
  assert.ok(M.agentExtra({focus: 'speaker', split: false}).includes(M.SPLIT.promptOff));
  assert.ok(!M.agentExtra({focus: 'manual'}).some((l) => l === M.SPLIT.promptOn || l === M.SPLIT.promptOff));
});

test('吸附：模型给的时间落到最近的句首和句尾，终点不会跑到起点前面', () => {
  const r = M.snap(S, S[4].start + 0.9, S[9].end - 1.1);
  assert.deepEqual([r.from, r.to], [4, 9]);
  assert.equal(r.start, S[4].start);
  assert.equal(r.end, S[9].end);
  const tiny = M.snap(S, S[8].start + 0.2, S[6].end);
  assert.ok(tiny.to >= tiny.from);
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
  const trimmed = child('c1', 37, 53, {used: [{start: S[50].start, end: S[53].end}]});
  assert.equal(M.doneBy(inside, [trimmed]), null);
});

test('提醒：固定次序与文案；重叠只和勾上的别的候选比', () => {
  const params = {length: 'mid', tracks: 'both'};
  const a = Object.assign({id: 'a', on: true}, M.rangeOf(S, 4, 13));
  const b = Object.assign({id: 'b', on: false, weak: true}, M.rangeOf(S, 11, 22));
  const list = [a, b];
  const fb = M.flags(b, {params, list, children: [], sentences: S});
  assert.deepEqual(fb.map((f) => f.k), ['overlap', 'context']);
  assert.equal(fb[0].text, `和第 1 支重叠 ${Math.round(M.overlapSec(a, b))} 秒`);
  assert.equal(fb[1].text, '要靠前文才听得懂');
  assert.deepEqual(M.flags(a, {params, list, children: [], sentences: S}), [], 'b 没勾，a 不提重叠');

  const long = Object.assign({id: 'l', on: true}, M.rangeOf(S, 0, 20));   // 约 70 秒
  const fl = M.flags(long, {params, list: [long], children: [child('c1', 2, 18)], sentences: S});
  assert.deepEqual(fl.map((f) => f.k), ['done', 'long'], '不再提平台时长');
  assert.match(fl[0].text, /^已切过 · 「/);
  assert.equal(fl[1].text, `比你要的长 ${Math.round(long.end - long.start - 60)} 秒`);
  // 1–3 分钟那一档：70 秒在区间里，不提
  assert.deepEqual(M.flags(long, {params: {length: 'xl', tracks: 'both'}, list: [long], sentences: S}), []);

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
});

test('演示候选：要几支给几支，不多找备选；互不重叠、不含要靠前文的', () => {
  const list = M.demoCandidates(S, {count: 3, length: 'mid'}, {children: []});
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((c) => c.start), list.map((c) => c.start).slice().sort((a, b) => a - b), '按原片先后');
  assert.equal(M.chosen(list).length, 3);
  list.forEach((a) => list.forEach((b) => { if (a !== b) assert.ok(M.overlapSec(a, b) < 1); }));
  assert.ok(list.every((c) => !c.weak));
  list.forEach((c) => assert.deepEqual(M.flags(c, {params: {length: 'mid', tracks: 'both'}, list, children: [], sentences: S}), [], c.title));
  assert.match(M.resultHead(list), /^已创建 3 支 · 合计 \d+:\d\d$/);
  assert.equal(M.demoMore, undefined);
  assert.equal(M.pickHeadline, undefined);
  // 要得比找得到的多：有几段给几段，仍然互不重叠
  const many = M.demoCandidates(S, {count: 10}, {children: []});
  assert.ok(many.length > 3 && many.length <= 10);
  many.forEach((a) => many.forEach((b) => { if (a !== b) assert.ok(M.overlapSec(a, b) < 1); }));
  // 时长档跟着区间中点伸缩
  const xl = M.demoCandidates(S, {count: 1, length: 'xl'}, {children: []});
  assert.ok(xl[0].end - xl[0].start > 90);
});

test('演示候选：切过的那一段开着「不再找」时不出现，关掉后也排在没切过的后面', () => {
  const kids = [child('p5', 37, 53)];
  const skip = M.demoCandidates(S, {count: 3, skipDone: true}, {children: kids});
  assert.ok(skip.every((c) => !M.doneBy(c, kids)));
  assert.equal(skip.length, 3);
  const keep = M.demoCandidates(S, {count: 3, skipDone: false}, {children: kids});
  assert.equal(keep.filter((c) => M.doneBy(c, kids)).length, 0);
  assert.equal(keep.length, 3);
  const all = M.demoCandidates(S, {count: 10, skipDone: false}, {children: kids});
  assert.equal(all.filter((c) => M.doneBy(c, kids)).length, 1, '不够时才补切过的');
});

test('演示候选：只在一章里找时起点都在这一章，不跨章就收在章尾之前', () => {
  const scope = {start: 95, end: 158};
  const list = M.demoCandidates(S, {count: 2}, {scope, children: []});
  assert.ok(list.length >= 1);
  list.forEach((c) => { assert.ok(c.start >= 95 - 0.02 && c.end <= 158 + 0.02, c.title); });
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
  const p = M.childProject({id: 'ps1', parent: Object.assign({dir: '/Videos/科浪访谈'}, parent), seg, title: '为什么做本机',
    params: {focus: 'manual'}, session: 's9', messageId: 'r-t1'});
  assert.deepEqual(p.origin, {project: 'p1', in: S[4].start, out: S[13].end, dur: S[13].end}, '来源记录没时长时退到片段终点');
  assert.deepEqual(p.cuts.map((c) => [c.id, c.start, c.end, c.kind, c.state, c.by]), [['outside-head', 0, S[4].start, 'outside', 'cut', 'agent']]);
  assert.equal(p.used, undefined, '用到哪几段从剪口派生，不另存');
  const full = M.childProject({id: 'ps4', parent, seg, title: 'd', dur: DUR});
  assert.deepEqual(full.cuts.map((c) => [c.start, c.end]), [[0, S[4].start], [S[13].end, DUR]]);
  assert.deepEqual(M.usedRanges(full), [{start: S[4].start, end: S[13].end}]);
  assert.deepEqual([p.delivery, p.ratio, p.bare], ['shorts', '9:16', true]);
  assert.deepEqual([p.dir, p.folder], ['/Videos/科浪访谈', '为什么做本机'], '和来源视频并排，各占一个视频文件夹');
  assert.deepEqual([p.session, p.messageId], ['s9', 'r-t1']);
  assert.equal(p.src.name, parent.src.name);
  assert.notEqual(p.src, parent.src);
  assert.equal(p.duration, +(S[13].end - S[4].start).toFixed(2));
  assert.equal(p.cut.focusX, 32);
  assert.equal(p.meta.cues, 10);
  assert.equal(M.checkLine, undefined);
  const sq = M.childProject({id: 'ps2', parent, seg, title: 'b', params: {ratio: '1:1'}});
  assert.deepEqual([sq.ratio, sq.dir, sq.session], ['1:1', null, null]);
  const src = M.childProject({id: 'ps3', parent: Object.assign({ratio: '16:9'}, parent), seg, title: 'c', params: {ratio: 'source'}});
  assert.deepEqual([src.ratio, src.cut.ratio, src.cut.focus], ['16:9', 'source', null]);
  assert.equal(M.cutLine(src.cut), '保留原画幅 · 原文 + 译文');
});

test('交给 Agent 的附加句：条数、时长、画幅与取景、字幕、范围、不再找，最后一句是直接创建', () => {
  const x = M.agentExtra({count: 4, length: 'short', skipDone: true, hook: true, tracks: 'orig'}, {children: 2, scopeName: '产品演示'});
  assert.match(x[0], /^要 4 支，每支 15–30 秒/);
  assert.ok(x.includes('画幅 9:16，取景自动：在片段里均匀抽几帧，看说话的人在画面哪一侧，把裁框放到他身上；找不到人就居中'));
  assert.ok(M.agentExtra({focus: 'manual'}).includes('画幅 9:16，取景我自己定'));
  assert.ok(x.includes('字幕：只要原文，短视频字幕'));
  assert.ok(x.includes('只在「产品演示」里找'));
  assert.ok(x.includes('已经切过的 2 支不用再找'));
  assert.equal(x[x.length - 1], '找好就直接创建成视频，不用先问我');
  assert.equal(M.DIRECT_LINE, '找好就直接创建成视频，不用先问我');
  assert.ok(!x.some((l) => /候选库|备选/.test(l)));
  const bare = M.agentExtra({hook: false, ratio: 'source', length: 'custom', lenMin: 100, lenMax: 400}, {});
  assert.deepEqual(bare.slice(0, 2), ['几支由你按话题定，每支 100–400 秒，起止落在句子边界上', '画幅：保留原画幅，不裁']);
  assert.equal(bare.length, 4);
});

test('自动：几支、多长交给 Agent 按话题定；下拉、摘要、附加句、提醒与进行中的文案', () => {
  assert.deepEqual(M.COUNTS.map((c) => c.id), ['auto', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual([M.countName('auto'), M.countName(4), M.countName(0)], ['自动', '4 支', '1 支']);
  assert.deepEqual(M.lengthRange({length: 'auto'}), {id: 'auto', min: null, max: null, name: '自动'});
  assert.equal(M.normalize({count: 'auto', length: 'auto'}, {}).count, 'auto');

  assert.equal(M.summaryLine({}), '按话题定几支、多长 · 9:16 · 自动');
  assert.equal(M.summaryLine({count: 4}), '4 支 · 每支按话题定长短 · 9:16 · 自动');
  assert.equal(M.summaryLine({length: 'short', ratio: 'source'}), '几支按话题定 · 每支 15–30 秒 · 保留原画幅');

  const auto = M.lengthRange({length: 'auto'}), mid = M.lengthRange({length: 'mid'});
  assert.equal(M.countLine('auto', auto), '几支由你按话题定，每支多长按话题定：从开头能抓人的那句剪到讲完，起止落在句子边界上');
  assert.equal(M.countLine(3, auto), '要 3 支，每支多长按话题定：从开头能抓人的那句剪到讲完，起止落在句子边界上');
  assert.equal(M.countLine('auto', mid), '几支由你按话题定，每支 30–60 秒，起止落在句子边界上');
  assert.equal(M.countLine(3, mid), '要 3 支，每支 30–60 秒，起止落在句子边界上');
  assert.equal(M.agentExtra({})[0], M.countLine('auto', auto));
  assert.match(M.autoHint({}), /几支、每支多长都按话题定/);
  assert.match(M.autoHint({length: 'mid'}), /^自动：够格的话题有几个就切几支/);
  assert.match(M.autoHint({count: 3}), /^自动：每支从开头能抓人的那句剪到话题讲完/);
  assert.equal(M.autoHint({count: 3, length: 'mid'}), null);

  // 自动时长没有「要的区间」，长短不提醒
  const long = Object.assign({id: 'l', on: true}, M.rangeOf(S, 0, 20));
  const short = Object.assign({id: 's', on: true}, M.rangeOf(S, 5, 8));
  assert.deepEqual(M.flags(long, {params: {length: 'auto', tracks: 'orig'}, list: [long], sentences: S}), []);
  assert.deepEqual(M.flags(short, {params: {length: 'auto', tracks: 'orig'}, list: [short], sentences: S}), []);

  // 自动支数：够格的有几段给几段，不拿要靠前文的凑；至多 10 支，互不重叠
  const list = M.demoCandidates(S, {}, {children: []});
  assert.ok(list.length >= 3 && list.length <= M.COUNT.max);
  assert.ok(list.every((c) => !c.weak), '不拿弱的凑');
  list.forEach((a) => list.forEach((b) => { if (a !== b) assert.ok(M.overlapSec(a, b) < 1); }));

  assert.equal(M.creatingTitle('auto'), '正在创建短视频…');
  assert.equal(M.creatingTitle(3), '正在创建 3 支短视频…');
  assert.match(M.createNote('auto'), /^它会按找到的话题创建子视频/);
  assert.match(M.createNote(2), /^它会创建 2 支子视频/);
  // 从自动切到自定义：手动加的一段凑到「30–60 秒」那一档的中间
  const c = M.manualCandidate(S, {t: S[20].start + 1, params: {length: 'auto'}});
  assert.ok(c.end - c.start >= 45);
});

test('列表副题：跟着会话走，切过的补一句', () => {
  const list = M.demoCandidates(S, {count: 3}, {children: []});
  assert.equal(M.listStatus(null, '挑几段', 0), '挑几段');
  assert.equal(M.listStatus({phase: 'setup'}, '挑几段', 2), '挑几段 · 已有 2 支');
  assert.equal(M.listStatus({phase: 'running', stage: 'find', pct: 44.6}, 'x', 0), '正在找片段 · 45%');
  assert.equal(M.listStatus({phase: 'running', stage: 'create', pct: 60}, 'x', 0), '正在创建视频 · 60%');
  assert.equal(M.listStatus({phase: 'result', list}, 'x', 0), '已创建 3 支');
  assert.equal(M.listStatus({phase: 'result', list: list.map((c, i) => (i ? c : Object.assign({}, c, {removed: true})))}, 'x', 0), '已创建 2 支');
  assert.equal(M.stageAt(M.FIND_STAGES, 0), 0);
  assert.equal(M.stageAt(M.FIND_STAGES, 100), 2);
});

/* ---------- 短视频项目里的「原片」卡 ---------- */
const el = (id, start, end, srcStart) => ({id, kind: 'video', fromSource: true, start, end, srcStart});

test('原片条色块：按百分比', () => {
  const b = M.bar([{start: 0, end: 103}, {start: 200, end: 300}], DUR);
  assert.deepEqual(b[0], {left: 0, width: 50});
  assert.ok(Math.abs(b[1].left + b[1].width - 100) < 0.01);
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
  const b = child('k2', 37, 53, {cut: {focus: 'auto', tracks: 'orig', style: 'shorts'},
    used: [{start: S[37].start, end: S[54].end}]});
  const c = child('k3', 56, 61, {used: [{start: S[56].start, end: S[61].end}, {start: S[20].start, end: S[22].end}]});
  const kids = [a, b, c];
  const head = M.madeHead(kids);
  assert.equal(head.count, 3);
  assert.match(head.text, /^3 支 · 合计 \d+:\d\d$/);
  assert.equal(M.madeHead([]).text, '0 支 · 合计 0:00');
  const rows = M.madeRows(kids);
  assert.deepEqual(rows.map((r) => [r.id, r.n, r.edited]), [['k1', 1, false], ['k2', 2, true], ['k3', 3, true]]);
  assert.equal(rows[0].span, `${M.mmss(S[4].start)} – ${M.mmss(S[13].end)}`);
  assert.equal(rows[0].cut, '跟着说话的人 · 原文 + 译文');
  assert.equal(rows[1].cut, '自动 · 只要原文');
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

test('切出的短视频一组：新建的在最上面，默认露出 6 行，多的「还有 N 支」展开', () => {
  const kids = [
    child('old', 4, 13, {ctime: 900}),
    child('none', 20, 22, {}),
    child('new2', 30, 33, {ctime: 0}),
    child('mid', 37, 53, {ctime: 60}),
    child('new1', 56, 61, {ctime: 0}),
  ];
  assert.deepEqual(M.madeOrder(kids).map((k) => k.id), ['new2', 'new1', 'mid', 'old', 'none'], '同时建的保持原序，缺 ctime 沉底');
  assert.deepEqual(M.madeOrder([]), []);
  assert.equal(M.MADE_SHOWN, 6);
  assert.deepEqual(M.madeVisible(4, false), {shown: 4, hidden: 0, expanded: false});
  assert.deepEqual(M.madeVisible(6, true), {shown: 6, hidden: 0, expanded: false}, '不超出时没有展开这回事');
  assert.deepEqual(M.madeVisible(11, false), {shown: 6, hidden: 5, expanded: false});
  assert.deepEqual(M.madeVisible(11, true), {shown: 11, hidden: 5, expanded: true});
  assert.equal(M.madeMoreLabel(5, false), '还有 5 支');
  assert.equal(M.madeMoreLabel(5, true), '收起');
});

test('调整后再生成：现状连着就带现状，剪成几段带切出时的那一段；不拿自己当已切过', () => {
  const kid = child('k2', 37, 53, {title: '字幕为什么是单独的一层', cut: {focus: 'manual', focusX: 0.62, tracks: 'trans', style: 'project'},
    used: [{start: S[37].start, end: S[54].end}]});
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

  const split = child('k3', 56, 61, {used: [{start: S[56].start, end: S[61].end}, {start: S[20].start, end: S[22].end}]});
  const d = M.redoCandidate(S, split);
  assert.deepEqual([d.from, d.to], [56, 61]);
  assert.match(d.reason, /切出时的起止/);

  const dragged = child('k4', 4, 13, {used: [{start: S[4].start + 0.8, end: S[13].end}]});
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
  const p = M.redoParams(kid, {count: 5, length: 'short', focus: 'auto'}, {hasTrans: true, portrait: false, children: 1});
  assert.deepEqual([p.count, p.length, p.focus, p.tracks, p.style], [5, 'short', 'manual', 'trans', 'project']);
  assert.equal(M.redoParams(kid, {}, {hasTrans: false, portrait: true, children: 1}).tracks, 'orig');
  assert.equal(M.redoParams(kid, {}, {hasTrans: false, portrait: true, children: 1}).focus, 'auto');
  assert.equal(M.redoParams(child('k5', 4, 13), {}, {hasTrans: true}).focus, 'auto');
  assert.equal(M.redoParams(child('k6', 4, 13, {cut: {ratio: 'source'}}), {}, {hasTrans: true}).ratio, 'source');

  const cand = M.redoCandidate(S, kid);
  assert.equal(M.redoPlan(null), 'fresh');
  assert.equal(M.redoPlan({phase: 'setup', list: []}), 'fresh');
  assert.equal(M.redoPlan({phase: 'running', list: []}), 'busy');
  assert.equal(M.redoPlan({phase: 'result', list: [cand]}), 'append');
  assert.equal(M.redoPlan({phase: 'result', list: [Object.assign({}, cand, {removed: true})]}), 'fresh');
  assert.equal(M.redoAppend, undefined);
  assert.equal(M.pickLead, undefined);
});

test('子视频的剪口：片段外两条，已生效、Agent 写的；空的一头不写；记录里有就用记录', () => {
  const c = M.seedCuts({in: 10, out: 40, dur: 100});
  assert.deepEqual(c.map((x) => [x.id, x.start, x.end, x.kind, x.state, x.by]),
    [['outside-head', 0, 10, 'outside', 'cut', 'agent'], ['outside-tail', 40, 100, 'outside', 'cut', 'agent']]);
  assert.deepEqual(M.seedCuts({in: 0, out: 100, dur: 100}), []);
  assert.deepEqual(M.seedCuts({in: 0, out: 40}).length, 0, '没记来源时长就当片段到头');
  const kid = {id: 'k', origin: {project: 'p1', in: 10, out: 40, dur: 100}};
  assert.deepEqual(M.cutsOf(kid), c);
  const own = [{id: 'x', start: 0, end: 5, kind: 'outside', state: 'cut'}];
  assert.equal(M.cutsOf({...kid, cuts: own}), own);
  assert.deepEqual(M.cutsOf({id: 'p'}), []);
  assert.equal(M.sourceDur(kid), 100);
});

test('留下的几段：扣掉已生效的剪口，建议不算；重叠、越界都收得住', () => {
  const cuts = [
    {id: 'a', start: 0, end: 10, state: 'cut'}, {id: 'b', start: 20, end: 25, state: 'cut'},
    {id: 's', start: 30, end: 35, state: 'suggested'}, {id: 'c', start: 22, end: 28, state: 'cut'},
    {id: 'd', start: 90, end: 120, state: 'cut'},
  ];
  assert.deepEqual(M.keptRanges(cuts, 100), [{start: 10, end: 20}, {start: 28, end: 90}]);
  assert.deepEqual(M.keptRanges([], 50), [{start: 0, end: 50}]);
  assert.deepEqual(M.keptRanges([{start: 0, end: 50, state: 'cut'}], 50), []);
  // 恢复一句（剪口变短）→ 用到的区间跟着变长；剪成两段也认得出
  const kid = {id: 'k', origin: {project: 'p1', in: 10, out: 40, dur: 100},
    cuts: [{id: 'outside-head', start: 0, end: 6, kind: 'outside', state: 'cut'}, {id: 'outside-tail', start: 40, end: 100, kind: 'outside', state: 'cut'},
      {id: 'f', start: 20, end: 22, kind: 'filler', state: 'cut'}]};
  assert.deepEqual(M.usedRanges(kid), [{start: 6, end: 20}, {start: 22, end: 40}]);
  assert.equal(M.editedSince(kid), true);
  assert.equal(M.editedSince({...kid, cuts: undefined}), false);
});

test('点一句恢复：片段前后的话连同中间几句一起放回，片段保持连着；缝里的只放回自己', () => {
  const kept = [{start: 20, end: 30}, {start: 35, end: 50}];
  assert.deepEqual(M.reclaimSpan(kept, {start: 12, end: 15}), {start: 12, end: 20});
  assert.deepEqual(M.reclaimSpan(kept, {start: 60, end: 64}), {start: 50, end: 64});
  assert.deepEqual(M.reclaimSpan(kept, {start: 31, end: 33}), {start: 31, end: 33});
  assert.deepEqual(M.reclaimSpan([], {start: 1, end: 2}), {start: 1, end: 2});
  assert.equal(M.reclaimSpan(kept, null), null);
});

test('文稿折叠：两端各留 3 句划掉，再远的收成一条剪缝；单位是句，被拆开的段出局部段', () => {
  // 62 句每 4 句一段，片段是第 20–29 句
  const paras = [];
  for (let i = 0; i < S.length; i += 4) paras.push({id: 'pa' + i, cueIds: S.slice(i, i + 4).map((c) => c.id)});
  const byId = new Map(S.map((c) => [c.id, c]));
  const cueOf = (id) => byId.get(id);
  const kept = [{start: S[20].start, end: S[29].end}];
  const rows = M.foldRows(paras, cueOf, kept);
  assert.equal(M.NEAR, 3);
  const head = rows[0];
  assert.deepEqual([head.kind, head.side, head.id, head.count, head.open, head.shown, head.next], ['fold', 'before', 'fold-g1', 17, false, 0, 10]);
  assert.equal(head.start, S[0].start);
  assert.equal(head.end, S[16].end);
  assert.equal(head.text, `前面 ${M.durText(S[16].end - S[0].start)}已剪掉`);
  const cueRows = rows.filter((r) => r.kind === 'para').flatMap((r) => r.para.cueIds);
  assert.deepEqual(cueRows, S.slice(17, 33).map((c) => c.id), '片段 10 句加两头各 3 句');
  const part = rows[1];
  assert.equal(part.part, true);
  assert.deepEqual(part.para.cueIds, ['g18', 'g19', 'g20']);
  assert.equal(part.para.id, 'pa16:g18');
  assert.equal(part.para.start, S[17].start);
  const tail = rows[rows.length - 1];
  assert.deepEqual([tail.kind, tail.side, tail.id], ['fold', 'after', 'fold-g34']);
  assert.match(tail.text, /^后面 \d+ 分( \d+ 秒)?已剪掉$/);
  // 分批展开：前面的缝每次铺出靠近片段的 10 句（铺在缝下面），缝 id 不变，剩下的仍收着
  const one = M.foldRows(paras, cueOf, kept, {shown: new Map([['fold-g1', M.STEP]])});
  assert.equal(M.STEP, 10);
  assert.deepEqual([one[0].kind, one[0].id, one[0].count, one[0].shown, one[0].next, one[0].open], ['fold', 'fold-g1', 7, 10, 7, true]);
  assert.equal(one[0].start, S[0].start);
  assert.equal(one[0].end, S[6].end);
  assert.deepEqual(one.filter((r) => r.kind === 'para').flatMap((r) => r.para.cueIds).slice(0, 3), ['g8', 'g9', 'g10']);
  const all = M.foldRows(paras, cueOf, kept, {shown: new Map([['fold-g1', 17]])});
  assert.deepEqual([all[0].id, all[0].count, all[0].next], ['fold-g1', 0, 0]);
  assert.equal(all[0].text, '前面划掉的 17 句都展开了');
  assert.equal(all[1].para.cueIds[0], 'g1');
  // 后面的缝：铺在缝上面，从片段那头往后
  const after = M.foldRows(paras, cueOf, kept, {shown: new Map([['fold-g34', 10]])});
  const last = after[after.length - 1];
  assert.deepEqual([last.kind, last.id, last.shown], ['fold', 'fold-g34', 10]);
  assert.equal(last.start, S[43].start);
  // 片段中间剪掉一大段：中间那条缝
  const gap = M.foldRows(paras, cueOf, [{start: S[5].start, end: S[6].end}, {start: S[40].start, end: S[41].end}]);
  assert.ok(gap.some((r) => r.kind === 'fold' && r.side === 'between'));
  assert.deepEqual([M.durText(45), M.durText(72), M.durText(120)], ['45 秒', '1 分 12 秒', '2 分']);
});

test('文稿段头时码：留下的段按这一支的时钟（剪掉的不占时间），整段在片段外返回 null', () => {
  const kept = [{start: 20, end: 30}, {start: 35, end: 50}];
  assert.equal(M.clipTime(kept, 20, 24), 0);
  assert.equal(M.clipTime(kept, 26, 28), 6);
  assert.equal(M.clipTime(kept, 36, 40), 11);
  assert.equal(M.clipTime(kept, 18, 22), 0, '段跨进片段：取段里第一处留下的地方');
  assert.equal(M.clipTime(kept, 31, 33), null);
  assert.equal(M.clipTime(kept, 60, 62), null);
  assert.equal(M.clipTime(kept, 12, 15), null);
});

test('取景：裁成别的画幅时铺满画面，focusX 对着正中并夹住不露边；保留原画幅不动', () => {
  const base = M.framePlace(null, 16 / 9, 9 / 16);
  assert.deepEqual(base, {x: 50, y: 50, w: 100, h: 100, scale: 1});
  assert.deepEqual(M.framePlace({ratio: 'source'}, 16 / 9, 16 / 9), base);
  const s = M.coverScale(16 / 9, 9 / 16);
  assert.ok(Math.abs(s - (16 / 9) / (9 / 16)) < 0.001);
  const center = M.framePlace({ratio: '9:16', focusX: null}, 16 / 9, 9 / 16);
  assert.deepEqual([center.x, center.scale], [50, s]);
  const left = M.framePlace({ratio: '9:16', focusX: 0.3}, 16 / 9, 9 / 16);
  assert.ok(left.x > 50, '看原片偏左的地方 → 视频往右挪');
  const edge = M.framePlace({ratio: '9:16', focusX: 0}, 16 / 9, 9 / 16);
  assert.ok(Math.abs(edge.x - (50 + (100 * s - 100) / 2)) < 0.01, '到头就夹住，左边不露底');
  assert.equal(M.framePlace({ratio: '1:1', focusX: 0.2}, 9 / 16, 1).x, 50, '竖的原片放进方画幅只上下裁');
  assert.deepEqual([M.focusText(null), M.focusText(0.5), M.focusText(0.3), M.focusText(0.62)], ['居中', '居中', '偏左 20%', '偏右 12%']);
  /* 同一份取景记成取景点（BC_FRAMING）：换画幅时按它重新对准；保留原画幅、没有 cut 时不记 */
  assert.deepEqual(M.frameFocal({ratio: '9:16', focusX: 0.3}), {x: 0.3, y: 0.5, zoom: 1});
  assert.deepEqual(M.frameFocal({ratio: '9:16', focusX: null}), {x: 0.5, y: 0.5, zoom: 1});
  assert.equal(M.frameFocal({ratio: '9:16', focusX: 1.4}).x, 1, '夹在 [0, 1]');
  assert.equal(M.frameFocal({ratio: 'source', focusX: 0.3}), null);
  assert.equal(M.frameFocal(null), null);
});

test('全部导出：每支有保留段的各一条，没有可导出内容的跳过并说明；文案与生产 zh-Hans 一致', () => {
  const seg = {start: S[4].start, end: S[13].end, from: 4, to: 13, title: 't', focusX: null};
  const a = M.childProject({id: 'e1', parent, seg, title: '第一支', dur: DUR});
  const b = M.childProject({id: 'e2', parent, seg, title: '第二支', dur: DUR});
  const empty = Object.assign({}, M.childProject({id: 'e3', parent, seg, title: '第三支', dur: DUR}),
    {cuts: [{id: 'all', start: 0, end: DUR, kind: 'cut', state: 'cut', by: 'user', text: ''}]});
  const {run, skipped} = M.exportBatch([a, b, empty]);
  assert.deepEqual(run.map((x) => x.project.id), ['e1', 'e2']);
  assert.ok(Math.abs(run[0].seconds - (seg.end - seg.start)) < 0.05);
  assert.deepEqual(skipped, [{name: '第三支', reason: '还在打开'}]);
  const n = M.exportNotes(run.length, skipped);
  assert.equal(n.started, '已发起 2 份导出 · 进度在后台任务里');
  assert.equal(n.skipped, '跳过了 1 支 · 「第三支」：还在打开');
  assert.deepEqual(M.exportNotes(0, []), {started: null, skipped: null});
  assert.equal(M.EXPORT_COPY.exportAllSub(3), '3 支各导出一份成片');
  assert.equal(M.EXPORT_COPY.exportAll, '全部导出…');
});

/* ---------- 按镜头分段取景 ---------- */
const CLIPS = [{id: 'k1', start: 0, end: 28, src: 0}, {id: 'k2', start: 28, end: 45.2, src: 28}, {id: 'k3', start: 45.2, end: 78, src: 45.2}];
const SHOTS = [{start: 13.3, end: 28, focusX: 0.3}, {start: 28, end: 39.9, focusX: 0.5}, {start: 39.9, end: 46.5, focusX: 0.74}];
const base = () => window.BC_VIDEO_EDIT.initial(CLIPS, 'a.mp4');

test('shotElements：在镜头边界处切开原片视频，每段按自己镜头的 focusX 落位', () => {
  const out = M.shotElements(base(), SHOTS, 16 / 9, 9 / 16);
  assert.deepEqual(out.map((e) => [e.id, e.start, e.end, e.shot]), [
    ['video-k1', 0, 28, 0],
    ['video-k2', 28, 39.9, 1],
    ['video-k2-shot2', 39.9, 45.2, 2],
    ['video-k3', 45.2, 78, 2],
  ]);
  const at = (fx) => M.framePlace({focusX: fx}, 16 / 9, 9 / 16).x;
  assert.deepEqual(out.map((e) => e.place.x), [at(0.3), at(0.5), at(0.74), at(0.74)]);
  assert.equal(out[2].srcStart, 39.9, '右半的 srcStart 跟着切点走');
  assert.ok(out.every((e) => e.place.scale === M.coverScale(16 / 9, 9 / 16)), '每段都铺满');
  assert.deepEqual(out.map((e) => e.focal.x), [0.3, 0.5, 0.74, 0.74], '每段记自己镜头的取景点');
  assert.ok(out.every((e) => e.focal.y === 0.5 && e.focal.zoom === 1));
});

test('shotElements：镜头之前 / 之后（恢复回来的首尾句子）沿用首 / 末镜头；边界贴着元素两端不切', () => {
  const out = M.shotElements(base(), [{start: 13.3, end: 28.02, focusX: 0.2}, {start: 28.02, end: 46.5, focusX: 0.8}], 16 / 9, 9 / 16);
  assert.deepEqual(out.map((e) => [e.id, e.shot]), [['video-k1', 0], ['video-k2', 1], ['video-k3', 1]], '28.02 离 k2 头不到 0.05 秒，不切出碎片');
  assert.equal(M.shotAt(SHOTS, 0), 0);
  assert.equal(M.shotAt(SHOTS, 120), 2);
  /* 倍速：镜头边界按 srcStart 与 rate 换算到时间轴 */
  const fast = M.shotElements([Object.assign(base()[1], {rate: 2})], SHOTS, 16 / 9, 9 / 16);
  assert.deepEqual(fast.map((e) => [e.start, e.end]), [[28, 33.95], [33.95, 45.2]]);
});

test('shotElements：没有镜头时与逐件 framePlace（居中）一样；不是原片的元素原样放过', () => {
  const sticker = {id: 's', kind: 'sticker', start: 0, end: 5};
  const out = M.shotElements(base().concat(sticker), [], 16 / 9, 9 / 16);
  assert.equal(out.length, 4);
  assert.ok(out.slice(0, 3).every((e) => e.shot == null && e.place.x === 50));
  assert.ok(out.slice(0, 3).every((e) => e.focal.x === 0.5), '没有镜头时取景点居中');
  assert.equal(out[3].focal, undefined, '只有视频记取景点');
  assert.equal(M.shotElements([sticker], SHOTS, 16 / 9, 9 / 16)[0], sticker);
});

test('shotsOf / frameText / shotBadge：结果卡的取景行与画布小牌', () => {
  assert.equal(M.shotsOf({shots: SHOTS}).length, 3);
  assert.equal(M.shotsOf({shots: SHOTS, ratio: 'source'}).length, 0, '保留原画幅不取景');
  assert.equal(M.frameText({shots: SHOTS}), '按 3 个镜头分别取景 · 打开后选中某一段可以放大，要挪位置先改成自由摆放');
  assert.equal(M.frameText({}, 0.3), '偏左 20% · 打开后选中这段视频可以放大，要挪位置先改成自由摆放');
  const fold = (t) => Math.max(0, t - 13.3);
  assert.equal(M.shotBadge({start: 28, end: 39.9}, fold), '这一段 · 第 15–27 秒');
  assert.equal(M.shotBadge({start: 0, end: 28}, fold), '这一段 · 第 0–15 秒', '片段外的头折到 0');
});

test('childProject：候选带镜头时子视频记 `cut.shots`；保留原画幅时不记', () => {
  const seg = Object.assign({id: 'x', title: 't'}, M.rangeOf(S, 37, 48), {shots: [{start: S[37].start, end: S[41].start, focusX: 0.3}, {start: S[41].start, end: S[48].end, focusX: 0.7}]});
  const kid = M.childProject({id: 'k', parent, seg, title: 't', params: {}});
  assert.equal(kid.cut.shots.length, 2);
  assert.notEqual(kid.cut.shots[0], seg.shots[0], '复制，不共用');
  assert.equal(M.childProject({id: 'k', parent, seg, title: 't', params: {ratio: 'source'}}).cut.shots, undefined);
  const d = M.demoCandidates(S, {}, {children: []}).find((c) => c.id === 'sc-d');
  assert.equal(d.shots.length, 3);
  assert.equal(d.shots[0].start, d.start);
  assert.equal(d.shots[2].end, d.end);
});

test('子视频落点：URL 没带 Tab 落在文稿；结果页点卡带 tab=aitools 停在结果页', () => {
  assert.equal(M.childLanding(null), 'transcript');
  assert.equal(M.childLanding(undefined), 'transcript');
  assert.equal(M.childLanding('aitools'), 'aitools');
  assert.equal(M.childLanding('subtitle'), 'subtitle');
});

test('进文稿调起止的落点：片段前面有收起的剪缝就落在它，没有就落在片段第一句所在的段', () => {
  const paras = [];
  for (let i = 0; i < S.length; i += 4) paras.push({id: 'pa' + i, cueIds: S.slice(i, i + 4).map((c) => c.id)});
  const byId = new Map(S.map((c) => [c.id, c]));
  const cueOf = (id) => byId.get(id);
  assert.deepEqual(M.entryAnchor(paras, cueOf, [{start: S[20].start, end: S[29].end}]), {fold: 'fold-g1'});
  // 片段从第 1 句开始：前面没有剪缝，落在第一段
  assert.deepEqual(M.entryAnchor(paras, cueOf, [{start: S[0].start, end: S[9].end}]), {para: 'pa0'});
  // 片段前只有 NEAR 句以内：不收剪缝，落在片段第一句所在的段
  assert.deepEqual(M.entryAnchor(paras, cueOf, [{start: S[2].start, end: S[9].end}]), {para: 'pa0'});
  assert.deepEqual(M.entryAnchor(paras, cueOf, [{start: S[3].start, end: S[9].end}]), {para: 'pa0'});
  // 前面多出 NEAR 句就收成剪缝，id 取那一截的第一句
  assert.deepEqual(M.entryAnchor(paras, cueOf, [{start: S[6].start, end: S[9].end}]), {fold: 'fold-g1'});
  assert.equal(M.entryAnchor(paras, cueOf, []), null);
});

test('入口文案与按钮：横幅给「去文稿调整」、结果页正在看那张卡给「调起止」、文稿提示卡追加一句', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const E = M.CUT_ENTRY_COPY;
  assert.equal(E.adjust, '去文稿调整');
  assert.equal(E.trim, '调起止');
  assert.equal(E.hint, '片段外的话已划掉，点一下放回来');
  const banner = read('shorts-source.jsx');
  assert.match(banner, /SC\.cutEntryAction\(ctx\.tab, ctx\.cutOrigin/);
  assert.match(banner, /onClick=\{onEntry\}>\{entry\.label\}/);
  assert.match(banner, /回到原片/);
  assert.doesNotMatch(banner, /片段外的话划掉保留/);
  const result = read('panel-aitools-shorts-result.jsx');
  assert.match(result, /cur && onTrim \? <Btn[^>]*>\{SC\.CUT_ENTRY_COPY\.trim\}/);
  assert.ok(result.indexOf('CUT_ENTRY_COPY.trim}') < result.indexOf('>不要这支<'), '「调起止」在「不要这支」左侧');
  const tc = read('panel-transcript-cut.jsx');
  assert.match(tc, /ctx\.composed \? <span>\{window\.BC_SHORTS_CUT\.CUT_ENTRY_COPY\.hint\}/);
  assert.match(tc, /data-fold=\{fold\.id\}/);
  assert.match(read('editor.jsx'), /shortsChild \? SC\.childLanding\(null\)/);
});

test('横幅入口那一格：不在文稿是「去文稿调整」', () => {
  const E = M.CUT_ENTRY_COPY;
  for (const tab of ['aitools', 'video', 'elements', 'subtitle']) {
    assert.deepEqual(M.cutEntryAction(tab, null, {hasResult: true, ai: true}), {kind: 'adjust', label: E.adjust, tip: E.adjustTip, to: 'transcript'});
  }
  // 记着来处但已经离开文稿（编辑器会清掉，这里也不看它）
  assert.equal(M.cutEntryAction('video', {tab: 'aitools'}, {hasResult: true, ai: true}).kind, 'adjust');
});

test('横幅入口那一格：从别的面板跳进文稿，回那个面板；从结果页来且有结果页是「回到结果页」', () => {
  const r = M.cutEntryAction('transcript', {tab: 'aitools'}, {hasResult: true, ai: true, railLabel: 'AI 工具'});
  assert.deepEqual(r, {kind: 'back', label: '回到结果页', tip: M.CUT_ENTRY_COPY.backTip, to: 'aitools'});
  assert.deepEqual(M.cutEntryAction('transcript', {tab: 'video'}, {hasResult: true, ai: true, railLabel: '视频'}),
    {kind: 'back', label: '回到视频', tip: M.CUT_ENTRY_COPY.backTip, to: 'video'});
  assert.equal(M.cutEntryAction('transcript', {tab: 'elements'}, {railLabel: '元素'}).label, '回到元素');
  // 从 AI 工具来但没有结果页（或表面没有 AI 工具）：按 rail 名回去
  assert.equal(M.cutEntryAction('transcript', {tab: 'aitools'}, {hasResult: false, ai: true, railLabel: 'AI 工具'}).label, '回到 AI 工具');
  assert.equal(M.cutEntryAction('transcript', {tab: 'aitools'}, {hasResult: true, ai: false, railLabel: 'AI 工具'}).label, '回到 AI 工具');
});

test('横幅入口那一格：直接落在文稿（或点过 rail），有结果页且有 AI 工具给「看结果页」，否则不摆', () => {
  assert.deepEqual(M.cutEntryAction('transcript', null, {hasResult: true, ai: true}),
    {kind: 'result', label: '看结果页', tip: M.CUT_ENTRY_COPY.resultTip, to: 'aitools'});
  assert.equal(M.cutEntryAction('transcript', null, {hasResult: false, ai: true}).kind, null);
  assert.equal(M.cutEntryAction('transcript', null, {hasResult: true, ai: false}).kind, null);
  assert.equal(M.cutEntryAction('transcript', undefined).kind, null);
  // 来处就是文稿（不会被记下，防御）：当作没有来处
  assert.equal(M.cutEntryAction('transcript', {tab: 'transcript'}, {hasResult: true, ai: true}).kind, 'result');
});

test('编辑器：openCutEntry 记下来处，离开文稿 / 点 rail / 换视频清掉，closeCutEntry 回去', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const ed = fs.readFileSync(path.join(__dirname, 'editor.jsx'), 'utf8');
  assert.match(ed, /if \(tab !== 'transcript'\) setCutOrigin\(\{tab, paneView\}\)/);
  assert.match(ed, /useEffect\(\(\) => \{ if \(tab !== 'transcript'\) setCutOrigin\(null\); \}, \[tab\]\)/);
  assert.match(ed, /if \(clearCutOrigin\) clearCutOrigin\(\); setTab\(key\)/);
  assert.match(ed, /openCutEntry, cutOrigin, closeCutEntry, clearCutOrigin/);
});

/* ---------- 分屏同框（docs/design/shorts-framing） ---------- */
test('shotElements：多人全景的镜头写分屏的格子，最左的人在上面；元素自己的取景点照旧给一份', () => {
  window.BC_PANELS = require('./model-panels.js');
  const regions = [{left: 0.55, top: 0.12, right: 0.15, bottom: 0.3}, {left: 0.15, top: 0.12, right: 0.55, bottom: 0.3}];
  const shots = [SHOTS[0], Object.assign({}, SHOTS[1], {regions}), SHOTS[2]];
  const out = M.shotElements(base(), shots, 16 / 9, 9 / 16);
  const split = out.filter((e) => e.panels);
  assert.deepEqual(split.map((e) => e.id), ['video-k2']);
  assert.equal(split[0].panels.length, 2);
  assert.ok(split[0].panels[0].focal.x < split[0].panels[1].focal.x, '左边那个人在上格');
  assert.deepEqual(split[0].panels.map((p) => p.rect.y), [0, 50]);
  assert.equal(split[0].focal.x, 0.5, '一人的取景点仍按这个镜头的 focusX');
  delete window.BC_PANELS;
});

test('layoutStrip：按这一支的时长排开一人段与分屏段，相邻同版式并成一段；没有分屏段不画', () => {
  const regions = [{left: 0.1, top: 0, right: 0.6, bottom: 0}, {left: 0.6, top: 0, right: 0.1, bottom: 0}];
  const cut = {ratio: '9:16', shots: [{start: 10, end: 14, focusX: 0.3}, {start: 14, end: 20, focusX: 0.3, regions},
    {start: 20, end: 25, focusX: 0.7}, {start: 25, end: 30, focusX: 0.3}]};
  const strip = M.layoutStrip(cut, {start: 10, end: 30});
  assert.deepEqual(strip.map((g) => [g.start, g.end, g.n]), [[10, 14, 1], [14, 20, 2], [20, 30, 1]]);
  assert.equal(strip[1].label, '0:04 – 0:10 · 分屏 2 格');
  assert.ok(Math.abs(strip.reduce((a, g) => a + g.len, 0) - 1) < 1e-9);
  assert.equal(M.layoutStrip({ratio: '9:16', shots: [cut.shots[0], cut.shots[2]]}, {start: 10, end: 30}), null);
  assert.equal(M.frameText(cut), '4 段 · 1 段分屏 · 打开后选中某一段可以改版式、互换上下');
});

test('多人全景时分屏：缺省开，提示词多一行；关掉、自己定取景或保留原画幅时不说分屏', () => {
  assert.equal(M.DEFAULTS.split, true);
  assert.ok(M.agentExtra({}).includes(M.SPLIT.promptOn));
  assert.ok(M.agentExtra({split: false}).includes(M.SPLIT.promptOff));
  assert.ok(!M.agentExtra({focus: 'manual'}).some((x) => x === M.SPLIT.promptOn || x === M.SPLIT.promptOff));
  assert.ok(!M.agentExtra({ratio: 'source'}).some((x) => x === M.SPLIT.promptOn || x === M.SPLIT.promptOff));
  assert.equal(M.normalize({split: undefined}, {}).split, true);
});
