const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
global.window.BC_LANGUAGES = require('./model-languages.js');
require('./model-tool-targets.js');
const TT = global.window.BC_TOOL_TARGETS;

const movies = [
  {id: 'raw', title: '没转录的', dir: 'd1', status: 'ready', src: {name: 'raw.mp4', state: 'ok'}, mtime: 1},
  {id: 'tx', title: '转录过的', dir: 'd1', status: 'complete', model: 'moss-transcribe', lang: '中文', src: {name: 'a.mp4', state: 'ok'}, mtime: 30},
  {id: 'tr', title: '有译文的', dir: 'd2', status: 'complete', model: 'moss-transcribe', lang: '中文', src: {name: 'b.mp4', state: 'ok'}, mtime: 5,
   content: {trans: [{lang: 'English', text: 'a'}, {lang: 'English', text: 'b'}, {lang: '日本語', text: 'c'}]}},
  {id: 'dub', title: '有配音的', dir: 'd2', status: 'complete', src: {name: 'c.mp4', state: 'ok'}, mtime: 3,
   docs: {transcripts: [{id: 'dub-tx1', lang: 'zh'}], translations: [{id: 'dub-tr1', lang: 'en', from: 'dub-tx1'}], dubs: [{id: 'dub-d1', lang: 'en', translation: 'dub-tr1'}]}},
  {id: 'run', title: '转录中', status: 'transcribing', model: 'moss-transcribe', src: {name: 'd.mov', state: 'ok'}, mtime: 0},
  {id: 'q', title: '排队', status: 'queued', model: 'x', src: {name: 'e.mp4', state: 'ok'}, mtime: 2},
  {id: 'bad', title: '失败', status: 'error', model: 'x', src: {name: 'f.mov', state: 'ok'}, mtime: 4},
  {id: 'gone', title: '源文件丢了', status: 'complete', model: 'whisper', lang: '英语', src: {name: 'g.mp4', state: 'missing'}, mtime: 6},
  {id: 'blank', title: '空白', status: 'ready', src: {name: '', state: 'ok'}, mtime: 7},
  {id: 'trash', title: '回收站里', status: 'complete', model: 'x', lang: '中文', archived: true, src: {name: 'h.mp4', state: 'ok'}, mtime: 0},
];
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('语言名与码互认：演示数据里的三种写法归到同一个码', () => {
  assert.equal(TT.langCode('中文'), 'zh');
  assert.equal(TT.langCode('简体中文'), 'zh');
  assert.equal(TT.langCode('English'), 'en');
  assert.equal(TT.langCode('英语'), 'en');
  assert.equal(TT.langCode('日本語'), 'ja');
  assert.equal(TT.langCode('Français'), 'fr');
  assert.equal(TT.langCode('自动检测'), null);
  assert.equal(TT.langLabel('en'), '英语');
  assert.equal(TT.langLabel('it'), 'Italiano');
});

test('文档事实：从记录推出文稿与译文；显式的 docs 优先；改返回值不动记录', () => {
  const f = TT.facts(movies[2]);
  assert.deepEqual(f.transcripts.map((t) => t.lang), ['zh']);
  assert.deepEqual(f.translations.map((t) => t.lang), ['en', 'ja'], '同一种语言的多句只算一份译文');
  assert.equal(f.state, 'done');
  assert.equal(TT.facts(movies[0]).state, 'none');
  assert.equal(TT.facts(movies[4]).state, 'running');
  assert.equal(TT.facts(movies[4]).transcripts.length, 0, '转录中的视频还没有文稿');
  const d = TT.facts(movies[3]);
  assert.deepEqual(d.dubs.map((x) => x.lang), ['en']);
  d.dubs.push({id: 'x'});
  assert.equal(movies[3].docs.dubs.length, 1);
});

test('翻译字幕的候选：只有转录过的能选，没转录的置灰并说明原因；能选的在前，按最近活动排', () => {
  const rows = TT.candidates('translate', movies);
  assert.ok(!rows.some((r) => r.id === 'trash'), '回收站里的不列');
  const ok = rows.filter((r) => r.eligible).map((r) => r.id);
  assert.deepEqual(ok, ['dub', 'tr', 'gone', 'tx']);
  assert.deepEqual(rows.slice(0, 4).map((r) => r.id), ok, '能选的排在前面');
  const by = byId(rows);
  assert.equal(by.raw.reason, '还没有文稿，先转录');
  assert.match(by.run.reason, /正在转录/);
  assert.match(by.q.reason, /队列/);
  assert.match(by.bad.reason, /转录失败/);
  assert.deepEqual(by.tr.tags.map((t) => t.label), ['文稿 · 中文', '译文 · 英语、日语']);
  assert.deepEqual(by.dub.tags.map((t) => t.k), ['transcript', 'translation', 'dub']);
});

test('转录的候选：要有素材；转录过的照样能选（新建视频或取代），转录中 / 缺源文件的不能选', () => {
  const by = byId(TT.candidates('transcribe', movies));
  assert.equal(by.raw.eligible, true);
  assert.equal(by.tx.eligible, true);
  assert.equal(by.bad.eligible, true, '失败过的可以再转录');
  assert.equal(by.run.eligible, false);
  assert.match(by.gone.reason, /源文件找不到/);
  assert.match(by.blank.reason, /没有可转录的素材/);
});

test('从链接导入加进已有视频：不要求文稿，回收站外的都能选', () => {
  const rows = TT.candidates('link', movies);
  assert.ok(rows.every((r) => r.eligible));
  assert.equal(rows.length, movies.length - 1);
});

test('搜索与预选：要的那部能选就用它，否则第一部能选的', () => {
  const rows = TT.candidates('dub', movies, {q: '有'});
  assert.deepEqual(rows.map((r) => r.id).sort(), ['dub', 'tr']);
  const all = TT.candidates('dub', movies);
  assert.equal(TT.pick(all, 'tx'), 'tx');
  assert.equal(TT.pick(all, 'raw'), 'dub', '没转录的不能被预选');
  assert.equal(TT.pick([], 'tx'), null);
});

test('已有同类结果时的说明：文稿默认新建视频、可选取代；译文与配音照旧新增一份', () => {
  assert.match(TT.duplicateNote('transcribe', movies[1]), /已有中文文稿.*默认新建一部视频.*取代这部视频的文稿/);
  assert.doesNotMatch(TT.duplicateNote('transcribe', movies[1]), /新增一份文稿|用哪一份在编辑器里选/);
  assert.equal(TT.duplicateNote('transcribe', movies[0]), null);
  assert.match(TT.duplicateNote('translate', movies[2], {lang: 'en'}), /已有英语译文/);
  assert.equal(TT.duplicateNote('translate', movies[2], {lang: 'ko'}), null);
  assert.match(TT.duplicateNote('dub', movies[3], {lang: 'en'}), /新增一组/);
});

test('写入结果只新增：旧的保留，推出来的事实先落成显式 docs', () => {
  const r = TT.withDoc(movies[2], 'translations', {lang: 'en', from: 'tr-tx1'});
  assert.deepEqual(r.docs.translations.map((t) => t.lang), ['en', 'ja', 'en']);
  assert.equal(r.docs.transcripts.length, 1);
  assert.equal(TT.facts({...movies[2], docs: r.docs}).translations.length, 3);
  assert.match(TT.langsText(r.docs.translations), /英语 ×2/);
  assert.equal(movies[2].docs, undefined, '记录本身不动');
  assert.equal(TT.withDoc(movies[2], 'nope', {}), null);
});

test('翻译配音能选的译文与翻译字幕的目标语言', () => {
  const opts = TT.translationOptions(movies[2]);
  assert.deepEqual(opts.map((o) => o.label), ['英语译文', '日语译文']);
  assert.equal(opts[0].sub, '译自中文文稿');
  const langs = [{code: 'zh'}, {code: 'en'}, {code: 'ja'}];
  assert.deepEqual(TT.targetLangs(langs, movies[2]).map((l) => l.code), ['en', 'ja'], '不能翻译成文稿自己的语言');
});

/* ---------- 重新转录的落点（product-design §5.11） ---------- */
const rich = {id: 'rich', title: '有译文有配音', status: 'complete', src: {name: 'r.mp4', state: 'ok'}, meta: {cues: 62},
  docs: {transcripts: [{id: 'rich-tx1', lang: 'zh', units: 62}],
    translations: [{id: 'rich-tr-en', lang: 'en', from: 'rich-tx1', units: 62, reviewed: 40}, {id: 'rich-tr-ja', lang: 'ja', from: 'rich-tx1', units: 62}],
    dubs: [{id: 'rich-dub-en', lang: 'en', translation: 'rich-tr-en', units: 62}], layers: [{id: 'rich-sub-zh', lang: 'zh'}], pins: 12}};
const touched = {id: 'ed', title: '改过原文', status: 'complete', model: 'whisper', lang: '英语', transcriptEdited: true, src: {name: 'e.mp4', state: 'ok'},
  meta: {cues: 30}, content: {trans: [{lang: '简体中文', text: 'x'}]}};

test('事实带句数、已审数、pin 与配音句数；没有这些字段的旧记录按 0 或文稿句数算', () => {
  const f = TT.facts(rich);
  assert.deepEqual(f.translations.map((t) => [t.lang, t.units, t.reviewed]), [['en', 62, 40], ['ja', 62, 0]]);
  assert.equal(f.pins, 12);
  assert.equal(f.dubs[0].units, 62);
  const g = TT.facts(touched);
  assert.deepEqual(g.translations.map((t) => [t.lang, t.units, t.reviewed]), [['zh', 30, 0]], '推出来的译文按文稿句数、已审 0');
  assert.equal(g.pins, 0);
  assert.equal(TT.facts(movies[2]).translations[0].units, 0, '记录里没有句数就是 0');
  assert.equal(TT.facts(movies[3]).pins, 0);
});

test('改过原文：transcriptEdited 或某份文稿 edited', () => {
  assert.equal(TT.edited(touched), true);
  assert.equal(TT.edited(rich), false);
  assert.equal(TT.edited({...rich, docs: {...rich.docs, transcripts: [{id: 'x', lang: 'zh', edited: true}]}}), true);
  assert.equal(TT.edited(null), false);
});

test('落点：有文稿 → 新建视频（默认）/ 取代；没有文稿（没转录过、上次失败） → 不显示', () => {
  const r = TT.retargetOptions(rich);
  assert.deepEqual(r.options.map((o) => o.k), ['new-video', 'replace']);
  assert.deepEqual(r.options.map((o) => o.label), ['新建视频', '取代这部视频的文稿']);
  assert.equal(r.value, 'new-video');
  assert.equal(r.edited, false);
  const e = TT.retargetOptions(touched);
  assert.equal(e.value, 'new-video', '改过原文默认也是新建视频');
  assert.equal(e.edited, true);
  assert.equal(TT.retargetOptions(movies[0]), null);
  assert.equal(TT.retargetOptions(movies[6]), null, '上次失败的没有文稿');
  assert.equal(TT.newVideoName(rich), '有译文有配音 · 重新转录');
});

test('影响预览：每种译文语言一行、pin 一行、配音一行、规则与撤销各一句', () => {
  const im = TT.replaceImpact(rich);
  assert.deepEqual(im.translations.map((t) => t.line), ['英语 · 62 句 · 已审 40 句', '日语 · 62 句']);
  assert.equal(im.pinLine, '12 处手工换行 / 固定时间 · 按时间重新锚定，锚不上的标 orphaned');
  assert.deepEqual(im.dubs.map((d) => d.line), ['英语 · 1 组 · 句子译文不变的保留，标可能不一致']);
  assert.match(im.rule, /原文没变的句子保留译文与审阅状态.*刷新过期译文/);
  assert.equal(im.undo, '一笔事务，可以撤销');
  assert.equal(im.edited, false);
  const none = TT.replaceImpact(movies[1]);
  assert.deepEqual(none.translations, []);
  assert.equal(none.pinLine, null);
  assert.deepEqual(none.dubs, []);
  assert.equal(TT.replaceImpact(touched).edited, true);
});

test('结转摘要：保留约 88%、已审按比例、pin 重锚 / orphaned、配音保留与过期；局部重跑只算范围内', () => {
  const c = TT.carrySummary(rich);
  const en = c.translations.find((t) => t.lang === 'en');
  assert.equal(en.kept + en.stale, 62);
  assert.equal(en.kept, 55);
  assert.ok(en.keptReviewed <= 40 && en.keptReviewed > 0);
  assert.deepEqual(c.captionPins, {reanchored: 11, orphaned: 1});
  assert.deepEqual(c.dubs, [{lang: 'en', label: '英语', kept: 55, stale: 7}]);
  assert.equal(c.lines[0], `英语：保留 55 句（已审 ${en.keptReviewed}）· 过期 7 句 · 字幕 pin 重锚 11 / orphaned 1 · 配音保留 55、过期 7`);
  assert.match(c.lines[1], /^日语：保留 \d+ 句（已审 0）· 过期 \d+ 句$/, 'pin 只在第一行报一次');
  const part = TT.carrySummary(rich, {share: 0.25});
  assert.ok(part.translations[0].kept + part.translations[0].stale < 20, '只算范围内的句子');
  assert.deepEqual(TT.carrySummary(movies[1]).lines, [], '没有译文没有 pin：没有结转');
});

test('取代文稿：替换第一份而不是追加，id 不变、版本加一、edited 清掉；译文、配音、pin 照旧带着', () => {
  const r = TT.withDoc(rich, 'transcripts', {lang: 'zh', model: 'moss-transcribe'}, {mode: 'replace'});
  assert.equal(r.docs.transcripts.length, 1);
  assert.equal(r.doc.id, 'rich-tx1');
  assert.equal(r.doc.version, 2);
  assert.equal(r.doc.model, 'moss-transcribe');
  assert.equal(r.replaced.id, 'rich-tx1');
  assert.equal(r.docs.translations.length, 2);
  assert.equal(r.docs.pins, 12);
  const e = TT.withDoc({...rich, docs: {...rich.docs, transcripts: [{id: 'x', lang: 'zh', edited: true}]}}, 'transcripts', {lang: 'zh'}, {mode: 'replace'});
  assert.equal(e.doc.edited, false);
  assert.equal(TT.withDoc(movies[0], 'transcripts', {lang: 'zh'}, {mode: 'replace'}).docs.transcripts.length, 1, '没有文稿时就是写进');
  assert.equal(TT.withDoc(rich, 'transcripts', {lang: 'zh'}).docs.transcripts.length, 2, '不给 mode 照旧追加');
});
