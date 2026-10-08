const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-writing.js');
const W = global.window.BC_WRITING;

const CHAPTERS = [
  {id: 'c1', title: '开场', start: 0, end: 22},
  {id: 'c2', title: '现场访谈', start: 22, end: 95},
  {id: 'c3', title: '产品演示', start: 95, end: 158},
  {id: 'c4', title: '观点与总结', start: 158, end: 206},
];
const CATALOG = [
  {code: 'en', native: 'English'}, {code: 'zh', native: '中文'}, {code: 'ja', native: '日本語'},
  {code: 'es', native: 'Español'}, {code: 'de', native: 'Deutsch'}, {code: 'fr', native: 'Français'},
];

test('分组：写作给读的人，发布给发视频的人', () => {
  assert.deepStrictEqual(Object.keys(W.GROUP).filter((k) => W.GROUP[k] === 'write'), ['summary', 'blog']);
  assert.deepStrictEqual(Object.keys(W.GROUP).filter((k) => W.GROUP[k] === 'publish'), ['title', 'desc', 'cover']);
});

test('时间码：整秒、满一小时进位，能读回来', () => {
  assert.strictEqual(W.mmss(41), '00:41');
  assert.strictEqual(W.mmss(3723), '1:02:03');
  assert.strictEqual(W.parseTime('01:44'), 104);
  assert.strictEqual(W.parseTime('1:02:03'), 3723);
  assert.strictEqual(W.parseTime('abc'), null);
});

test('视角：风格文档写了身份就照它', () => {
  const r = W.inferView({url: 'https://x.example/v'}, {role: 'author'});
  assert.strictEqual(r.view, 'author');
  assert.match(r.reason, /风格文档/);
});

test('视角：带来源链接按观众，本地文件按作者，依据可显示', () => {
  const v = W.inferView({url: 'https://www.kelang.example/ep42'});
  assert.strictEqual(v.view, 'viewer');
  assert.match(v.reason, /kelang\.example/);
  const a = W.inferView({title: 'local'});
  assert.strictEqual(a.view, 'author');
  assert.ok(a.reason);
  assert.strictEqual(W.inferView({source: {url: 'https://a.example/1'}}).view, 'viewer');
});

test('视角：用户点名的优先，auto 走推断', () => {
  assert.deepStrictEqual(W.resolveView('author', {url: 'https://a.example'}), {view: 'author', auto: false, reason: null});
  const r = W.resolveView('auto', {url: 'https://a.example'});
  assert.strictEqual(r.view, 'viewer');
  assert.strictEqual(r.auto, true);
});

test('语言缺省：写作组跟界面语言，发布组跟要发布的那一版或文稿', () => {
  const o = {ui: 'ja', src: 'es', publish: null};
  assert.deepStrictEqual(W.defaultLang('summary', o), {code: 'ja', why: '跟界面语言'});
  assert.deepStrictEqual(W.defaultLang('blog', o), {code: 'ja', why: '跟界面语言'});
  assert.deepStrictEqual(W.defaultLang('title', o), {code: 'es', why: '跟文稿'});
  assert.deepStrictEqual(W.defaultLang('desc', Object.assign({}, o, {publish: 'de'})), {code: 'de', why: '跟要发布的那一版'});
  assert.strictEqual(W.defaultLang('cover', o).code, 'es');
});

test('语言缺省：源语言不是中文也不是英文时不落到中文或英文', () => {
  const o = {ui: 'fr', src: 'es'};
  for (const tool of ['summary', 'blog', 'title', 'desc', 'cover']) {
    const c = W.defaultLang(tool, o).code;
    assert.ok(c === 'fr' || c === 'es', `${tool} → ${c}`);
  }
  // 界面语言认不出时写作组退到文稿语言
  assert.strictEqual(W.defaultLang('summary', {src: 'es'}).code, 'es');
});

test('语言下拉：项目已有的语言排前，原文在最前，其余不重复', () => {
  const [proj, other] = W.langOptions({src: 'es', trans: ['de', 'es', 'ja'], catalog: CATALOG});
  assert.deepStrictEqual(proj.items.map((x) => x.code), ['es', 'de', 'ja']);
  assert.strictEqual(proj.items[0].tag, '原文');
  assert.strictEqual(proj.items[1].tag, '已有译文');
  assert.deepStrictEqual(other.items.map((x) => x.code), ['en', 'zh', 'fr']);
  assert.strictEqual(W.langName('es', CATALOG), 'Español');
});

test('风格：自定义原样传，空的不传', () => {
  assert.strictEqual(W.styleText('sharp'), '毒舌');
  assert.strictEqual(W.styleText('custom', '  像写给朋友的信 '), '像写给朋友的信');
  assert.strictEqual(W.styleText('custom', ''), null);
});

const batch = (titles, extra) => Object.assign({cands: titles.map((t, i) => ({title: t, angle: 'a' + i, why: 'w'}))}, extra);

test('标题：新的一批放最前，推荐排第一，重复的去掉', () => {
  let st = W.emptyTitles();
  st = W.addBatch(st, batch(['A', 'B', 'C'], {recommended: 1}));
  assert.deepStrictEqual(W.ordered(W.current(st)).map((c) => c.title), ['B', 'A', 'C']);
  st = W.addBatch(st, batch(['  b ', 'D', 'a', 'E'], {kind: 'more'}));
  assert.deepStrictEqual(W.current(st).cands.map((c) => c.title), ['D', 'E']);
  assert.strictEqual(W.earlier(st).length, 1);
  assert.strictEqual(W.current(st).kind, 'more');
  // 整批都重复：状态不变
  assert.strictEqual(W.addBatch(st, batch(['A', 'D'])), st);
});

test('标题：选用是单选，再点取消；改字记 edited，改回原文不算', () => {
  let st = W.addBatch(W.emptyTitles(), batch(['A', 'B']));
  const [a, b] = W.current(st).cands;
  st = W.pickTitle(st, a.id);
  assert.strictEqual(W.pickedTitle(st), 'A');
  st = W.pickTitle(st, b.id);
  assert.strictEqual(st.picked.id, b.id);
  st = W.editPicked(st, 'B 改过');
  assert.deepStrictEqual(st.picked, {id: b.id, text: 'B 改过', edited: true});
  assert.strictEqual(W.editPicked(st, '  ').picked.text, 'B 改过');
  assert.strictEqual(W.editPicked(st, 'B').picked.edited, false);
  st = W.pickTitle(st, b.id);
  assert.strictEqual(st.picked, null);
  st = W.clearPick(W.pickTitle(st, a.id));
  assert.strictEqual(W.pickedTitle(st), null);
});

test('演示标题：一批里角度各不相同，再来一批优先没用过的角度', () => {
  let st = W.emptyTitles();
  const b1 = W.demoTitles(st, {lang: 'zh', count: 6});
  assert.strictEqual(b1.cands.length, 6);
  assert.strictEqual(new Set(b1.cands.map((c) => c.angle)).size, 6);
  st = W.addBatch(st, b1);
  const b2 = W.demoTitles(st, {lang: 'zh', count: 6, kind: 'more'});
  const used = new Set(b1.cands.map((c) => c.angle));
  assert.ok(b2.cands.every((c) => !used.has(c.angle)));
  st = W.addBatch(st, b2);
  assert.strictEqual(W.allCands(st).length, 12);
});

test('演示标题：照这个再来几个是同一角度的变体', () => {
  let st = W.addBatch(W.emptyTitles(), W.demoTitles(W.emptyTitles(), {lang: 'zh', count: 4}));
  const first = W.current(st).cands[0];
  const like = W.demoTitles(st, {lang: 'zh', kind: 'like', like: first.id});
  assert.ok(like.cands.length > 0);
  assert.ok(like.cands.every((c) => c.angle === first.angle));
  st = W.addBatch(st, like);
  assert.strictEqual(W.current(st).like, first.id);
});

test('演示标题：候选数夹在 3–12；没有样张的语言说明回落', () => {
  assert.strictEqual(W.demoTitles(W.emptyTitles(), {lang: 'zh', count: 1}).cands.length, 3);
  assert.deepStrictEqual(W.demoLang('es', 'es'), {code: 'zh', fallback: true});
  assert.deepStrictEqual(W.demoLang('ja', 'en'), {code: 'en', fallback: true});
  assert.deepStrictEqual(W.demoLang('en', 'zh'), {code: 'en', fallback: false});
});

test('封面库：选用同一时刻只有一张，删掉已选用的清空选用', () => {
  let lib = W.emptyCovers();
  lib = W.addCover(lib, {idea: 'x', base: 'frame'});
  lib = W.addCover(lib, {idea: 'y', base: 'drawn'});
  const [c1, c2] = lib.items;
  lib = W.pickCover(lib, c1.id);
  lib = W.pickCover(lib, c2.id);
  assert.strictEqual(lib.picked, c2.id);
  assert.strictEqual(W.pickCover(lib, c2.id).picked, null);
  assert.strictEqual(W.pickCover(lib, 'nope'), lib);
  lib = W.removeCover(lib, c2.id);
  assert.strictEqual(lib.picked, null);
  assert.deepStrictEqual(lib.items.map((x) => x.id), [c1.id]);
});

test('封面库：照这张再改，新的一张挨着原来那张，原图保留', () => {
  let lib = W.emptyCovers();
  ['a', 'b', 'c'].forEach((i) => { lib = W.addCover(lib, {idea: i, base: 'generated'}); });
  const mid = lib.items[1];
  lib = W.reviseCover(lib, mid.id, '字再大一点');
  assert.deepStrictEqual(lib.items.map((x) => x.idea), ['a', 'b', 'b', 'c']);
  assert.strictEqual(lib.items[2].from, mid.id);
  assert.strictEqual(lib.items[2].note, '字再大一点');
  assert.notStrictEqual(lib.items[2].id, mid.id);
  assert.strictEqual(W.reviseCover(lib, mid.id, '  '), lib);
  let one = W.addCover(W.emptyCovers(), W.frameCover({t: 116, scene: 'screen'}, '16:9'));
  one = W.reviseCover(one, one.items[0].id, '字换成白底黑字');
  assert.strictEqual(one.items[1].scene, 'screen');     // 改稿沿用原来那一帧的画面
  assert.deepStrictEqual(one.items[1].frames, [116]);
});

test('关键帧：确定地挑 8 帧，按章节带画面类型', () => {
  const f1 = W.autoFrames(CHAPTERS, 206, 8);
  assert.deepStrictEqual(f1, W.autoFrames(CHAPTERS, 206, 8));
  assert.strictEqual(f1.length, 8);
  assert.ok(f1.every((f, i) => i === 0 || f.t > f1[i - 1].t));
  assert.strictEqual(f1[0].scene, 'host');
  assert.ok(f1.some((f) => f.scene === 'screen' && f.people === 0));
});

test('关键帧：加上当前画面会钉住并按时间排；已在条上的只钉住', () => {
  const f = W.autoFrames(CHAPTERS, 206, 8);
  const g = W.addFrame(f, 100, CHAPTERS);
  assert.strictEqual(g.length, 9);
  const add = g.find((x) => x.t === 100);
  assert.ok(add.pinned && add.manual);
  assert.ok(g.every((x, i) => i === 0 || x.t >= g[i - 1].t));
  const h = W.addFrame(f, f[2].t + 0.3, CHAPTERS);
  assert.strictEqual(h.length, 8);
  assert.ok(h[2].pinned);
  assert.strictEqual(W.pinned(W.togglePin(h, f[2].t)).length, 0);
});

test('封面想法：路线轮换、钉住的帧优先、张数夹在 2–4', () => {
  let frames = W.togglePin(W.autoFrames(CHAPTERS, 206, 8), W.autoFrames(CHAPTERS, 206, 8)[5].t);
  const plan = W.planCovers({count: 4, routes: ['frame', 'drawn', 'generated'], frames, textMode: 'phrase', phrase: '本机更快', ratio: '16:9'});
  assert.deepStrictEqual(plan.map((p) => p.base), ['frame', 'drawn', 'generated', 'frame']);
  assert.deepStrictEqual(plan[0].frames, [frames[5].t]);
  assert.deepStrictEqual(plan[1].frames, []);
  assert.strictEqual(plan[0].text, '本机更快');
  assert.strictEqual(W.planCovers({count: 9, routes: ['drawn']}).length, 4);
  assert.strictEqual(W.planCovers({count: 1, routes: []})[0].base, 'frame');
});

test('封面想法：观众视角下参考重绘只用没有人的帧，没有就换回真实画面', () => {
  const frames = W.autoFrames(CHAPTERS, 206, 8);
  const p = W.planCovers({count: 2, routes: ['restyled'], frames, view: 'viewer'});
  assert.ok(p.every((x) => x.base === 'restyled' && x.scene === 'screen'));
  const people = frames.filter((f) => f.people > 0);
  const q = W.planCovers({count: 2, routes: ['restyled'], frames: people, view: 'viewer'});
  assert.ok(q.every((x) => x.base === 'frame'));
});

test('封面想法：用帧的路线各落在不同的帧上，想法写的是取到的那一帧', () => {
  const frames = W.autoFrames(CHAPTERS, 206, 8);
  const plan = W.planCovers({count: 3, routes: ['frame', 'restyled'], frames, view: 'author'});
  const ts = plan.map((p) => p.frames[0]);
  assert.strictEqual(new Set(ts).size, 3);
  plan.forEach((p) => assert.ok(p.idea.indexOf(W.mmss(p.frames[0])) >= 0, p.idea));
  const none = W.planCovers({count: 2, routes: ['frame', 'restyled'], frames: []});
  none.forEach((p) => assert.ok(p.idea && p.idea.indexOf('用 的') < 0 && !/\d\d:\d\d/.test(p.idea), p.idea));
});

test('直接用这一帧与画幅', () => {
  const c = W.frameCover({t: 104, scene: 'screen'}, '9:16');
  assert.strictEqual(c.base, 'frame');
  assert.strictEqual(c.by, 'user');
  assert.deepStrictEqual(c.frames, [104]);
  assert.strictEqual(W.ratioOf('project', '9:16'), '9:16');
  assert.strictEqual(W.ratioOf('project', 'Original'), '16:9');
  assert.strictEqual(W.ratioOf('1:1', '9:16'), '1:1');
});

test('交给 Agent 的附加要求：只写用户定下的，视角写出推断依据', () => {
  const view = W.resolveView('auto', {url: 'https://kelang.example/ep42'});
  const x = W.intentExtra('blog', {length: 'long', style: 'custom', custom: '像写给朋友的信', lang: 'es', view}, {lang: 'Español'});
  assert.deepStrictEqual(x.slice(0, 3), ['篇幅：长', '风格：像写给朋友的信', '用Español写']);
  assert.match(x[3], /^视角：观众（自动推断：/);
  const t = W.intentExtra('title', {length: 'long', style: 'plain'});
  assert.deepStrictEqual(t, ['风格：平实']);
  const where = '要发到：某视频站，按它的规定写，写完提醒我核对';
  assert.ok(W.intentExtra('title', {style: 'plain', platform: '某视频站'}).includes(where));
  assert.ok(W.intentExtra('desc', {style: 'plain', platform: '某视频站'}).includes(where));
  assert.ok(!W.intentExtra('blog', {style: 'plain', platform: '某视频站'}).includes(where));
  assert.match(W.platformNote(' 某视频站 '), /^要发到 某视频站：/);
  assert.strictEqual(W.platformNote('  '), null);
  const kept = W.addBatch(W.emptyTitles(), {cands: [{title: 'A'}], platform: '某视频站'});
  assert.strictEqual(W.current(kept).platform, '某视频站');
  const c = W.intentExtra('cover', {idea: '本机更快', ratio: '9:16', textMode: 'none', routes: ['frame', 'drawn'], pins: [41, 104], picked: 'T'});
  assert.ok(c.includes('已选用的标题：T'));
  assert.ok(c.includes('可以用的路线：真实画面、代码绘制'));
  assert.ok(c.includes('优先用我钉住的 2 帧（00:41、01:44）'));
});

test('Markdown：标题、列表、引用、段落；行内粗体与时间码', () => {
  const b = W.mdBlocks('# 标题\n\n第一段\n接着\n\n## 小节\n- 一 [00:41]\n> 引\n\n尾');
  assert.deepStrictEqual(b.map((x) => x.type), ['h1', 'p', 'h2', 'li', 'quote', 'p']);
  assert.strictEqual(b[1].text, '第一段 接着');
  const s = W.mdInline('a **b** c [01:44] d');
  assert.deepStrictEqual(s.map((x) => x.k), ['t', 'b', 't', 'time', 't']);
  assert.strictEqual(s[3].s, 104);
  assert.ok(!W.plain('**粗** 字').includes('**'));
});

test('演示正文：要点条数随篇幅，简介带章节时间码与标签', () => {
  const n = (len) => W.demoSummary('zh', len).points.length;
  assert.ok(n('short') < n('medium') && n('medium') < n('long'));
  assert.ok(W.demoSummary('en', 'medium').points.every((p) => typeof p.t === 'number'));
  assert.notStrictEqual(W.demoBlog('zh', 'author'), W.demoBlog('zh', 'viewer'));
  const d = W.demoDescription({lang: 'zh', view: 'viewer', chapters: CHAPTERS, title: '选用的标题'});
  assert.ok(d.text.startsWith('选用的标题'));
  assert.match(d.text, /00:22 现场访谈/);
  assert.match(d.text, /02:38 观点与总结/);
  assert.match(d.text, /出处/);
  assert.ok(d.tags.length >= 3);
  assert.doesNotMatch(W.demoDescription({lang: 'zh', view: 'author', chapters: CHAPTERS}).text, /出处/);
});
