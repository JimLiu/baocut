const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-transcript.js');
const TX = global.window.BC_TX;

const speakers = {s1: {name: '林澈'}, s2: {name: '周远'}};
const paras = [
  {id: 'p1', sp: 's1', start: 0, end: 7.14, text: '欢迎回到《码与远方》。', trans: 'Welcome back to Code & Wander.'},
  {id: 'p2', sp: 's2', start: 65.4, end: 70, text: '谢谢邀请。', trans: 'Thanks for having me.'},
];

test('语言投影：both 是两行对照而不是拼句', () => {
  assert.equal(TX.paraText(paras[0], 'src'), '欢迎回到《码与远方》。');
  assert.equal(TX.paraText(paras[0], 'trans'), 'Welcome back to Code & Wander.');
  assert.equal(TX.paraText(paras[0], 'both'), '欢迎回到《码与远方》。\nWelcome back to Code & Wander.');
});

test('词级时间戳只在原文', () => {
  assert.equal(TX.hasWordTiming('src'), true);
  assert.equal(TX.hasWordTiming('trans'), false);
  assert.equal(TX.hasWordTiming('both'), false);
});

test('初始分段徽章只认 active + provisional', () => {
  assert.equal(TX.initialSegmentsProvisional({active: true, provisional: true}), true);
  assert.equal(TX.initialSegmentsProvisional({active: false, provisional: true}), false);
  assert.equal(TX.initialSegmentsProvisional({active: true, provisional: false}), false);
  assert.equal(TX.initialSegmentsProvisional(null), false);
});

test('时间码是 mm:ss 且向下取整', () => {
  assert.equal(TX.stamp(0), '00:00');
  assert.equal(TX.stamp(65.9), '01:05');
});

test('纯文本复制：段间空行，无头行时不多插换行', () => {
  assert.equal(TX.copyText(paras, {lang: 'src'}),
    '欢迎回到《码与远方》。\n\n谢谢邀请。');
});

test('带时间码与说话人时正文另起一行', () => {
  assert.equal(TX.copyText(paras, {lang: 'src', time: true, speaker: true, speakers}),
    '00:00 林澈：\n欢迎回到《码与远方》。\n\n01:05 周远：\n谢谢邀请。');
  assert.equal(TX.copyText([paras[1]], {lang: 'trans', time: true, speakers}),
    '01:05\nThanks for having me.');
});

test('回执按语言换单位', () => {
  assert.equal(TX.copyReceipt(paras, 'src'), '2 段 · 12 字');
  assert.equal(TX.copyReceipt(paras, 'trans'), '2 段 · 9 词');
});

/* ---------- 转录中的实时切片 ---------- */

const live = [
  {id: 'p1', start: 0,  end: 10, text: '第一段一共十个字。'},
  {id: 'p2', start: 10, end: 20, text: 'Hello there my friends'},
  {id: 'p3', start: 20, end: 30, text: '第三段。'},
];

test('切片按音频位置算，只给整段：end <= at 才算识别到', () => {
  const a = TX.liveSlice(live, 30, 0);
  assert.deepEqual(a.settled, []);
  assert.equal(a.tailIndex, -1);            // 0% 是「还没解码出东西」，不是空段落
  assert.equal(a.at, 0);

  const b = TX.liveSlice(live, 30, 50);    // at = 15s，落在 p2 中间：p2 还没整段到达，不露前半句
  assert.deepEqual(b.settled.map((p) => p.id), ['p1']);
  assert.equal(b.tailIndex, 0);             // 光标挂在最后一个识别到的段落上

  const c = TX.liveSlice(live, 30, 70);    // at = 21s：p1、p2 到了，p3 还没
  assert.deepEqual(c.settled.map((p) => p.id), ['p1', 'p2']);
  assert.equal(c.tailIndex, 1);

  const d = TX.liveSlice(live, 30, 100);
  assert.deepEqual(d.settled.map((p) => p.id), ['p1', 'p2', 'p3']);
  assert.equal(d.tailIndex, -1);
});

test('进入保存阶段：识别位置 = 整段素材，不再有「识别中」', () => {
  assert.equal(TX.LIVE_SAVE_PCT, 99);
  assert.equal(TX.liveAtPct(98, 30), 29.4);
  assert.equal(TX.liveAtPct(99, 30), 30);
  const s = TX.liveSlice(live, 30, 99);
  assert.equal(s.settled.length, 3);
  assert.equal(s.saving, true);
  assert.equal(s.tailIndex, -1);
  assert.equal(TX.liveSlice(live, 30, 98).saving, false);
  assert.equal(TX.liveSaving({kind: 'transcribe', status: 'running', pct: 99}), true);
  assert.equal(TX.liveSaving({kind: 'transcribe', status: 'running', pct: 98}), false);
  assert.equal(TX.liveSaving({kind: 'transcribe', status: 'done', pct: 100}), false);
  assert.equal(TX.liveSaving(null), false);
  assert.equal(TX.liveStage(98), 2);
  assert.equal(TX.liveStage(99), 3);          // 「落盘」那一格亮起，与「正在保存转写」同时
});

test('转录位置只认 running 的第一次转录任务', () => {
  assert.equal(TX.liveAt(null, 30), null);
  assert.equal(TX.liveAt({kind: 'export', status: 'running', pct: 40}, 30), null);
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'queued', pct: 0}, 30), null);
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'running', pct: 100}, 30), null);
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'running', pct: 50}, 30), 15);
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'running', pct: 0}, 30), 0);
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'running', pct: 99}, 30), 30);   // 保存阶段：整段
  // 重新转录：视频已有字幕轨，轨原样留着——时间轴与画面不跟转录位置走（只有文稿面板切实时态）
  assert.equal(TX.liveAt({kind: 'transcribe', status: 'running', pct: 50, rerun: true}, 30), null);
});

test('字幕轨按转录位置切成 已识别 / 转录中 两段，没有半句', () => {
  const cues = [
    {id: 'c1', start: 0,  end: 10, text: '第一条一共十个字。'},
    {id: 'c2', start: 10, end: 20, text: 'Hello there my friends'},
    {id: 'c3', start: 20, end: 30, text: '第三条。'},
  ];
  const a = TX.liveTrackSlice(cues, 30, 0);
  assert.deepEqual(a.settled, []);
  assert.equal(a.tail, null);
  assert.deepEqual(a.pending, {start: 0, end: 30});   // 0% 整条轨都是待定带

  const b = TX.liveTrackSlice(cues, 30, 15);          // 落在 c2 中间：c2 还没整句到达
  assert.deepEqual(b.settled.map((c) => c.id), ['c1']);
  assert.equal(b.tail.id, 'c1');                       // 光标挂在最后一个识别到的 cue 末尾
  assert.deepEqual(b.pending, {start: 15, end: 30});

  const c = TX.liveTrackSlice(cues, 30, 20);          // 正好在边界：c2 落定，c3 还没开始
  assert.deepEqual(c.settled.map((x) => x.id), ['c1', 'c2']);
  assert.equal(c.tail.id, 'c2');
  assert.deepEqual(c.pending, {start: 20, end: 30});

  const e = TX.liveTrackSlice(cues, 30, 30);          // 保存阶段：全部到了，待定带收起，不再有光标
  assert.deepEqual(e.settled.map((x) => x.id), ['c1', 'c2', 'c3']);
  assert.equal(e.tail, null);
  assert.equal(e.pending, null);

  const d = TX.liveTrackSlice(cues, 30, null);        // 不在转录：原样
  assert.deepEqual(d.settled.map((x) => x.id), ['c1', 'c2', 'c3']);
  assert.equal(d.tail, null);
  assert.equal(d.pending, null);
});

test('画面上的字幕跟着转录位置：整句到了才出，没到的不出', () => {
  const cue = {id: 'c2', start: 10, end: 20, text: 'Hello there my friends'};
  assert.equal(TX.cueRecognized(cue, 5), false);
  assert.equal(TX.cueRecognized(cue, 15), false);       // 在 cue 中间：不露前半句
  assert.equal(TX.cueRecognized(cue, 20), true);
  assert.equal(TX.cueRecognized(cue, null), true);      // 不在转录：照常
});

test('阶段阶梯：解码只占开头，识别是主体', () => {
  assert.equal(TX.liveStage(0), 0);
  assert.equal(TX.liveStage(3), 0);
  assert.equal(TX.liveStage(45), 1);
  assert.equal(TX.liveStage(95), 2);
  assert.equal(TX.liveStage(100), 3);
  assert.equal(TX.LIVE_STAGES.length, 4);
});

/* ---------- cue 是写入单位，段落是投影（第 33 轮） ---------- */

const P = {id: 'p1', cueIds: ['g1', 'g2', 'g3']};
const TEXTS = {g1: '大家好，', g2: '我是苏黎，', g3: '负责渲染。'};
const CT = (t) => (id) => (id in t ? t[id] : '');

test('cueSpans 按 cue 原文相接切段落', () => {
  assert.deepEqual(TX.cueSpans(P, CT(TEXTS)), [
    {id: 'g1', start: 0, end: 4},
    {id: 'g2', start: 4, end: 9},
    {id: 'g3', start: 9, end: 14},
  ]);
  assert.equal(TX.paraSrc(P, CT(TEXTS)), '大家好，我是苏黎，负责渲染。');
});

test('落在一条 cue 里的命中可替换，跨了边界的不可', () => {
  const spans = TX.cueSpans(P, CT(TEXTS));
  assert.equal(TX.cueOfRange(spans, 6, 8), 'g2');      // 「苏黎」在 g2 里
  assert.equal(TX.cueOfRange(spans, 0, 4), 'g1');      // 整条 cue 也算落在里面
  assert.equal(TX.cueOfRange(spans, 3, 6), null);      // 跨 g1/g2 边界
  assert.equal(TX.cueOfRange(spans, 8, 11), null);     // 跨 g2/g3 边界
});

test('边界处开始的命中归后一条 cue，不是前一条', () => {
  const spans = TX.cueSpans(P, CT(TEXTS));
  assert.equal(TX.cueOfRange(spans, 4, 6), 'g2');
  assert.equal(TX.cueOfRange(spans, 9, 14), 'g3');
});

test('空 cue 不吞掉命中', () => {
  const t = {g1: '甲', g2: '', g3: '乙'};
  const spans = TX.cueSpans(P, CT(t));
  assert.deepEqual(spans.map((s) => s.id + s.start + '-' + s.end), ['g10-1', 'g21-1', 'g31-2']);
  assert.equal(TX.cueOfRange(spans, 1, 2), 'g3');
});

test('段落改写落在一条 cue 里时精确摊回那一条', () => {
  const next = '大家好，我是苏黎老师，负责渲染。';
  assert.deepEqual(TX.applyParaEdit(P, CT(TEXTS), next), {g2: '我是苏黎老师，'});
});

test('段落改写没动就不产生补丁', () => {
  assert.deepEqual(TX.applyParaEdit(P, CT(TEXTS), TX.paraSrc(P, CT(TEXTS))), {});
});

test('跨 cue 的大改压到第一条被触及的 cue 上，其余只留未触及的前后缀', () => {
  const next = '大家好，换掉中间这一大段。';
  const patch = TX.applyParaEdit(P, CT(TEXTS), next);
  // 摊回去之后段落正文必须与用户打的一模一样——这是这个近似唯一不能破的约束
  const merged = Object.assign({}, TEXTS, patch);
  assert.equal(TX.paraSrc(P, CT(merged)), next);
});

test('删光整段也能摊回去', () => {
  const patch = TX.applyParaEdit(P, CT(TEXTS), '');
  const merged = Object.assign({}, TEXTS, patch);
  assert.equal(TX.paraSrc(P, CT(merged)), '');
});

const sections = [
  {chapter: {id: 'c1', title: '开场', start: 0, end: 22}, index: 0, paras: [paras[0]]},
  {chapter: {id: 'c2', title: '现场访谈', start: 22, end: 95}, index: 1, paras: [paras[1]]},
  {chapter: {id: 'c3', title: '空章', start: 95, end: 158}, index: 2, paras: []},
];

test('exportText md：时间戳在段末、不加反引号；说话人每段都带 `**名字:**`；章节 `## 章名 · mm:ss`，空章不写', () => {
  const md = TX.exportText(sections, {fmt: 'md', lang: 'src', chapters: true, time: true, speaker: true, speakers, title: 'ep42'});
  assert.equal(md, [
    '# ep42', '## 开场 · 00:00', '**林澈:** 欢迎回到《码与远方》。 [00:00]',
    '## 现场访谈 · 00:22', '**周远:** 谢谢邀请。 [01:05]',
  ].join('\n\n'));
  assert.ok(!md.includes('`'));
  assert.ok(!md.includes('空章'));
});

test('exportText：只有一位说话人时也每段都带标签', () => {
  const one = [{chapter: null, index: 0, paras: [paras[0], Object.assign({}, paras[1], {sp: 's1'})]}];
  assert.equal(TX.exportText(one, {fmt: 'md', lang: 'src', speaker: true, speakers}),
    '**林澈:** 欢迎回到《码与远方》。\n\n**林澈:** 谢谢邀请。');
  assert.equal(TX.exportText(one, {fmt: 'txt', lang: 'src', speaker: true, speakers}),
    '林澈: 欢迎回到《码与远方》。\n\n林澈: 谢谢邀请。');
});

test('exportText txt：没有标题，章节 `— 章名 —`，标签 `名字: `，时间戳在段末', () => {
  const txt = TX.exportText(sections, {fmt: 'txt', lang: 'src', chapters: true, time: true, speaker: true, speakers, title: 'ep42'});
  assert.equal(txt, '— 开场 —\n\n林澈: 欢迎回到《码与远方》。 [00:00]\n\n— 现场访谈 —\n\n周远: 谢谢邀请。 [01:05]');
  assert.equal(TX.exportText(sections, {fmt: 'txt', lang: 'trans', chapters: true}),
    '— 开场 —\n\nWelcome back to Code & Wander.\n\n— 现场访谈 —\n\nThanks for having me.');
});

test('exportText 双语 md：时间戳跟在原文段后面，译文是原文段后单独一段引用', () => {
  assert.equal(TX.exportText(sections, {fmt: 'md', lang: 'both', time: true, speaker: true, speakers}),
    '**林澈:** 欢迎回到《码与远方》。 [00:00]\n\n> Welcome back to Code & Wander.\n\n**周远:** 谢谢邀请。 [01:05]\n\n> Thanks for having me.');
});

test('exportText 双语 txt：译文在同一段的下一行，不带标签与时间戳', () => {
  assert.equal(TX.exportText(sections, {fmt: 'txt', lang: 'both', time: true, speaker: true, speakers}),
    '林澈: 欢迎回到《码与远方》。 [00:00]\nWelcome back to Code & Wander.\n\n周远: 谢谢邀请。 [01:05]\nThanks for having me.');
  assert.equal(TX.exportText(sections, {fmt: 'txt', lang: 'both'}),
    '欢迎回到《码与远方》。\nWelcome back to Code & Wander.\n\n谢谢邀请。\nThanks for having me.');
});

test('时间码满一小时写成 hh:mm:ss：文稿面板复制与导出（段落、章节标题、frontmatter 的 chapters 与 duration）同一把尺', () => {
  assert.equal(TX.stamp(3599.9), '59:59');
  assert.equal(TX.stamp(3725), '01:02:05');
  const late = Object.assign({}, paras[1], {start: 3725.4});
  assert.equal(TX.copyText([late], {lang: 'src', time: true}), '01:02:05\n谢谢邀请。');
  const sec = [{chapter: {id: 'c9', title: '加时', start: 3700, end: 3800}, index: 0, paras: [late]}];
  assert.equal(TX.exportText(sec, {fmt: 'txt', lang: 'src', time: true}), '谢谢邀请。 [01:02:05]');
  const md = TX.exportText(sec, {fmt: 'md', lang: 'src', time: true, chapters: true, meta: TX.projectMeta({title: 't', duration: 3725}, {})});
  assert.ok(md.includes('duration: "01:02:05"'));
  assert.ok(md.includes('  - "[01:01:40] 加时"'));
  assert.ok(md.includes('## 加时 · 01:01:40'));
});

test('frontmatter：只有一位说话人也列 speakers；说话人关掉时不列', () => {
  const one = [{chapter: null, index: 0, paras: [paras[0]]}];
  const meta = {title: 't'};
  assert.equal(TX.exportText(one, {fmt: 'md', lang: 'src', speaker: true, speakers, meta}).split('\n\n')[0],
    '---\ntitle: "t"\nspeakers:\n  - "林澈"\n---');
  assert.equal(TX.exportText(one, {fmt: 'md', lang: 'src', speaker: false, speakers, meta}).split('\n\n')[0],
    '---\ntitle: "t"\n---');
});

test('frontmatter：与内核同一份字段顺序，缺的不写、换行折成空格、JSON 转义、只 md 生效', () => {
  const proj = {title: 'ep "42"', desc: '简介\n第二行 # 不是注释', url: 'https://x.example/42', duration: 3725, notes: '内部备注',
    source: {uploader: '科浪电台', publishedAt: '20260420', platform: 'YouTube'}};
  const meta = TX.projectMeta(proj, {language: 'zh', translation: 'ja'});
  const sections = [
    {chapter: {id: 'c1', title: '开场', start: 0, end: 22}, index: 0, paras: [paras[0]]},
    {chapter: {id: 'c2', title: '现场访谈', start: 22, end: 95}, index: 1, paras: [paras[1]]},
  ];
  const md = TX.exportText(sections, {fmt: 'md', lang: 'src', chapters: true, speaker: true, speakers, title: 'ep42', meta});
  assert.equal(md.split('\n\n# ep42')[0], [
    '---', 'title: "ep \\"42\\""', 'description: "简介 第二行 # 不是注释"', 'source: "https://x.example/42"', 'author: "科浪电台"',
    'published: "2026-04-20"', 'platform: "YouTube"', 'duration: "01:02:05"', 'language: "zh"', 'translation: "ja"',
    'speakers:', '  - "林澈"', '  - "周远"', 'chapters:', '  - "[00:00] 开场"', '  - "[00:22] 现场访谈"', '---',
  ].join('\n'));
  // 多行简介折成一行：不留 `\n` 转义给读文稿的人看
  assert.ok(!md.includes('\\n'));
  assert.ok(!md.includes('内部备注'));
  assert.ok(!md.includes('thumbnail'));
  assert.ok(!TX.exportText(sections, {fmt: 'txt', lang: 'src', meta}).includes('---'));
  const bare = TX.exportText(sections, {fmt: 'md', lang: 'src', meta: TX.projectMeta({title: 't', duration: 65}, {language: 'zh'})});
  assert.ok(bare.startsWith('---\ntitle: "t"\nduration: "01:05"\nlanguage: "zh"\n---\n\n'));
});

/* ---------- 文稿正文的选项：导出页与复制共用 ---------- */

test('复制组合：缺省是 Markdown、五个开关全开，坏值回落缺省', () => {
  assert.deepEqual(TX.copyOpts(undefined), TX.COPY_DEFAULTS);
  assert.deepEqual(TX.COPY_DEFAULTS, {fmt: 'md', frontmatter: true, chapters: true, time: true, speaker: true, skipCut: true});
  assert.deepEqual(TX.copyOpts({fmt: 'docx', time: 'yes', speaker: false}),
    Object.assign({}, TX.COPY_DEFAULTS, {speaker: false}));
  assert.deepEqual(TX.copyOpts({fmt: 'txt', chapters: false}), Object.assign({}, TX.COPY_DEFAULTS, {fmt: 'txt', chapters: false}));
  assert.deepEqual(TX.TEXT_OPTS.map((o) => o.k), ['frontmatter', 'chapters', 'time', 'speaker', 'skipCut']);
});

test('生效值：文首元信息只在 Markdown，章节标题要有章节；勾选本身保留', () => {
  const o = {fmt: 'txt', frontmatter: true, chapters: true, time: false, speaker: true, skipCut: true};
  const e = TX.textEffective(o, {chapters: false});
  assert.equal(e.frontmatter, false);
  assert.equal(e.chapters, false);
  assert.equal(o.frontmatter, true);
  assert.equal(TX.textEffective(Object.assign({}, o, {fmt: 'md'}), {chapters: true}).frontmatter, true);
});

test('组合零件：格式在前，跳过已剪段是缺省不写，关掉才写「含已剪段」', () => {
  assert.deepEqual(TX.textParts(TX.COPY_DEFAULTS), ['Markdown', '文首元信息', '章节标题', '段落时间戳', '说话人']);
  assert.deepEqual(TX.textParts({fmt: 'txt', frontmatter: false, chapters: false, time: false, speaker: false, skipCut: true}), ['纯文本']);
  const full = {fmt: 'md', frontmatter: true, chapters: true, time: true, speaker: true, skipCut: false};
  assert.deepEqual(TX.textParts(full), ['Markdown', '文首元信息', '章节标题', '段落时间戳', '说话人', '含已剪段']);
  assert.deepEqual(TX.textParts(full, 'chapter'), ['Markdown', '章节标题', '段落时间戳', '说话人', '含已剪段']);
  assert.deepEqual(TX.textParts(full, 'para'), ['Markdown', '段落时间戳', '说话人']);
});

test('复制全文与同样设置的导出逐字相同；纯文本没有标题', () => {
  const meta = {title: 'ep42', duration: '01:10'};
  const eff = TX.textEffective({fmt: 'md', frontmatter: true, chapters: true, time: true, speaker: true, skipCut: true}, {chapters: true});
  const base = {lang: 'src', speakers, title: 'ep42', meta};
  const copied = TX.exportText(sections, TX.textArgs(eff, 'all', base));
  assert.equal(copied, TX.exportText(sections, {fmt: 'md', lang: 'src', chapters: true, time: true, speaker: true, speakers, title: 'ep42', meta}));
  assert.ok(copied.startsWith('---\ntitle: "ep42"'));
  assert.ok(copied.includes('\n---\n\n# ep42\n\n## 开场 · 00:00'));
  const bodyOnly = {fmt: 'txt', frontmatter: false, chapters: false, time: false, speaker: false, skipCut: true};
  const plain = TX.exportText(sections, TX.textArgs(bodyOnly, 'all', base));
  assert.equal(plain, '欢迎回到《码与远方》。\n\n谢谢邀请。');
});

test('范围复制：这一章不写标题与文首元信息、章节标题照开关；这一段连章节标题也不写', () => {
  const eff = {fmt: 'md', frontmatter: true, chapters: true, time: true, speaker: true, skipCut: true};
  const base = {lang: 'src', speakers, title: 'ep42', meta: {title: 'ep42'}};
  assert.equal(TX.exportText([sections[1]], TX.textArgs(eff, 'chapter', base)),
    '## 现场访谈 · 00:22\n\n**周远:** 谢谢邀请。 [01:05]');
  assert.equal(TX.exportText([{chapter: null, index: 0, paras: [paras[0]]}], TX.textArgs(eff, 'para', base)),
    '**林澈:** 欢迎回到《码与远方》。 [00:00]');
});
