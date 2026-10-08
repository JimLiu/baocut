const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-newproject.js');
const N = global.window.BC_NEW;

const ready = {ready: true, state: 'ready'};
const missing = {ready: false, state: 'missing'};
const off = {ready: false, state: 'off'};

test('固定流程两组：不需要 AI 的一组带上空白视频；「交给 Agent」归页顶的框，不在磁贴里', () => {
  assert.deepEqual(N.ENTRIES.map((e) => e.k), ['media', 'agent', 'blank']);
  const [local, ai] = N.flowGroups();
  assert.deepEqual(local.items.map((g) => g.k), ['sub', 'a2v', 'blank']);
  assert.deepEqual(ai.items.map((g) => g.k), ['trans', 'clean']);
  assert.ok(local.items.every((g) => !g.ai) && ai.items.every((g) => g.ai));
  assert.equal(N.goal('blank').title, '空白视频');
  assert.equal(N.aiGate('blank', null, missing).ok, true);
});

test('路线：带素材走 ask；点过类型听用户的；否则按关键词猜，猜不出是自由发挥', () => {
  assert.deepEqual(N.kinds().map((g) => g.k), ['anim', 'board', 'math', 'sticker']);
  assert.equal(N.route('翻成英文', [{name: 'a.mp4', kind: 'media'}], 'math').goal, 'ask');
  assert.deepEqual(N.route('讲导数', [], 'board'), {goal: 'board', media: null, by: 'pick', scene: 'board'});
  assert.equal(N.route('用手绘白板讲清楚复利', []).goal, 'board');
  assert.equal(N.route('证明勾股定理', []).goal, 'math');
  assert.equal(N.route('做一条贴纸动画，讲乌龟的故事', []).goal, 'sticker');   // 「动画」不抢走贴纸
  assert.equal(N.route('用手绘贴纸拼一页剪贴簿', []).goal, 'sticker');         // 「手绘」不抢走贴纸
  assert.equal(N.route('剪贴簿风格的读书笔记', []).goal, 'sticker');
  assert.equal(N.route('把这份 PDF 做成产品介绍动画', [{name: 'x.pdf', kind: 'doc'}]).goal, 'anim');
  assert.deepEqual(N.route('做一条倒计时开场', []), {goal: 'free', media: null, by: 'none', scene: null});
  assert.equal(N.route('讲导数', [], 'nope').by, 'guess');    // 不认识的 picked 不算
  assert.equal(N.route('讲导数', [], 'sub').by, 'scene');     // 处理素材的场景：等一条视频或音频
  assert.match(N.routeNote(N.route('', [{name: 'a.mp4', kind: 'media'}])), /a\.mp4/);
  assert.match(N.routeNote(N.route('证明勾股定理', [])), /数学教学动画/);
});

test('路线走 ask 时流程先转录再交给 Agent，且要一句话才起跑', () => {
  assert.deepEqual(N.pipeline('ask', {}).map((s) => s.by), ['local', 'ai']);
  assert.equal(N.canStart('ask', {media: true}).ok, false);
  assert.equal(N.canStart('ask', {media: true, prompt: '翻成英文'}).ok, true);
});

test('Agent 入口的目标都不需要素材、只能交给 Agent', () => {
  const gs = N.goalsOf('agent');
  assert.deepEqual(gs.map((g) => g.k), ['anim', 'board', 'math', 'sticker', 'free']);
  assert.ok(gs.every((g) => g.ai && g.agentOnly && g.examples.length));
});

test('转录并翻译：转录是本机，其后三步都归 AI，目标语言进步骤名', () => {
  const steps = N.pipeline('trans', {targetName: '中文'});
  assert.deepEqual(steps.map((s) => s.k), ['transcribe', 'polish', 'translate', 'align']);
  assert.deepEqual(steps.map((s) => s.by), ['local', 'ai', 'ai', 'ai']);
  assert.equal(steps[2].label, '翻译成中文');
});

test('链接与模板在流程最前面各加一步', () => {
  assert.deepEqual(N.pipeline('sub', {url: true, tpl: true}).map((s) => s.k), ['download', 'tpl', 'transcribe']);
});

test('音频转视频关掉字幕就不转录；剪口播默认停在审阅', () => {
  assert.deepEqual(N.pipeline('a2v', {subs: false}).map((s) => s.k), ['canvas']);
  assert.equal(N.pipeline('clean', {}).slice(-1)[0].by, 'you');
  assert.equal(N.pipeline('clean', {review: false}).slice(-1)[0].k, 'apply');
});

test('Agent 制作：附了材料多一步读材料，最后交回用户', () => {
  assert.equal(N.pipeline('board', {attachments: 1})[0].k, 'read');
  assert.equal(N.pipeline('board', {}).slice(-1)[0].by, 'you');
});

test('闸门：不需要 AI 的目标恒过', () => {
  assert.deepEqual(N.aiGate('sub', null, missing), {ok: true, need: false});
});

test('闸门：翻译要一个就绪的执行者，Agent 或模型都行', () => {
  assert.equal(N.aiGate('trans', {kind: 'api', ready: true}, missing).ok, true);
  assert.equal(N.aiGate('trans', {kind: 'agent', ready: true}, ready).by, 'agent');
  assert.equal(N.aiGate('trans', {kind: 'api', ready: false}, ready).why, 'key-missing');
  assert.equal(N.aiGate('trans', {kind: 'agent', ready: false}, off).why, 'agent-off');
  assert.equal(N.aiGate('trans', null, missing).why, 'none');
});

test('闸门：只能交给 Agent 的目标不认云端模型', () => {
  assert.equal(N.aiGate('math', {kind: 'api', ready: true}, missing).why, 'agent-missing');
  assert.equal(N.aiGate('math', null, ready).ok, true);
});

test('引导：媒体目标给出不用 AI 的退路，Agent 制作没有退路', () => {
  const g = N.gateGuide('trans', N.aiGate('trans', null, missing));
  assert.equal(g.fallback, 'sub');
  assert.equal(N.gateGuide('anim', N.aiGate('anim', null, off)).fallback, null);
  assert.equal(N.gateGuide('anim', N.aiGate('anim', null, off)).enable, true);
  assert.equal(N.gateGuide('sub', N.aiGate('sub', null, missing)), null);
});

test('一次跑完的承诺：Agent 执行时说明已预先允许；剪口播停在审阅', () => {
  assert.match(N.oneShotNote('trans', {kind: 'agent'}), /预先允许.*不再问你/);
  assert.doesNotMatch(N.oneShotNote('trans', {kind: 'api'}), /预先允许/);
  assert.match(N.oneShotNote('clean', {kind: 'api'}), /停在审阅/);
});

test('主按钮写结果；链接前面加「下载并」', () => {
  assert.equal(N.cta('trans', {targetName: '中文'}), '转录并翻译成中文');
  assert.equal(N.cta('sub', {url: true}), '下载并生成字幕');
  assert.equal(N.cta('math'), '交给 Agent 制作');
  assert.equal(N.cta('blank'), '创建空白视频');
});

test('起跑条件', () => {
  assert.equal(N.canStart('sub', {}).ok, false);
  assert.equal(N.canStart('sub', {media: true}).ok, true);
  assert.equal(N.canStart('sub', {prompt: '这条 https://youtu.be/xyz'}).ok, true);
  assert.equal(N.canStart('ask', {media: true}).ok, false);
  assert.equal(N.canStart('anim', {attachments: 1}).ok, true);
  assert.equal(N.canStart('trans', {media: true, gate: {ok: false}}).why, '先连接 AI');
  assert.equal(N.canStart('trans', {media: true, sameLang: true}).ok, false);
  assert.equal(N.canStart('blank').ok, true);
});

test('记忆：最近翻过的语言去重置顶、最多五门', () => {
  let m = {};
  ['en', 'ja', 'en', 'ko', 'es', 'de', 'fr'].forEach((t) => { m = N.remember(m, {entry: 'media', goal: 'trans', target: t}); });
  assert.deepEqual(m.targets, ['fr', 'de', 'es', 'ko', 'en']);
  assert.equal(N.seed(m).target, 'fr');
  assert.equal(N.seed(m).goal, 'trans');
});

test('记忆：模板记 id，选「不用模板」也记；媒体项目不改记画幅', () => {
  let m = N.remember({}, {entry: 'media', goal: 'sub', tpl: 'chapters-bar', ratio: '9:16'});
  assert.equal(m.tpl, 'chapters-bar');
  assert.equal(m.ratio, undefined);
  m = N.remember(m, {entry: 'blank', tpl: null, ratio: '9:16'});
  assert.equal(m.tpl, null);
  assert.equal(N.seed(m).ratio, '9:16');
  assert.equal(N.seed(m).goal, 'sub');   // 空白不冲掉上次的媒体目标
});

test('记忆：坏值回落默认', () => {
  assert.deepEqual(N.seed({entry: 'x', goal: 'anim', agentGoal: 'nope', ratio: '4:3', shorts: 'yes'}),
    {entry: 'agent', goal: 'sub', agentGoal: null, target: 'en', bilingual: true, targetName: null, dir: null, tpl: null, ratio: '16:9', shorts: null});
});

test('记忆：Agent 只记亲手点的类型，不动空白项目的画幅', () => {
  let m = N.remember({ratio: '1:1'}, {entry: 'agent', picked: 'math'});
  assert.deepEqual([m.agentGoal, m.ratio], ['math', '1:1']);
  m = N.remember(m, {entry: 'agent', picked: null});
  assert.equal(N.seed(m).agentGoal, null);
});

test('目标语言分组与上次的模板', () => {
  const langs = [{code: 'en'}, {code: 'zh'}, {code: 'ja'}];
  const g = N.targetGroups({targets: ['ja', 'xx']}, langs);
  assert.deepEqual(g.recent.map((l) => l.code), ['ja']);
  assert.deepEqual(g.rest.map((l) => l.code), ['en', 'zh']);
  assert.equal(N.lastTemplate({tpl: 'b'}, [{id: 'a'}, {id: 'b'}]).id, 'b');
  assert.equal(N.lastTemplate({tpl: 'gone'}, [{id: 'a'}]), null);
});

test('旧的六类型入口落到新页', () => {
  assert.deepEqual(N.presetOf('trans'), {entry: 'media', goal: 'trans'});
  assert.deepEqual(N.presetOf('blank'), {entry: 'blank'});
  assert.equal(N.presetOf('tpl').pickTpl, true);
  assert.deepEqual(N.presetOf(null), {entry: 'agent'});
  assert.deepEqual(N.presetOf('ask'), {entry: 'agent', media: true});
});

test('后续链：翻译与剪口播有，转录没有', () => {
  assert.equal(N.chainOf('sub'), null);
  assert.deepEqual(N.chainOf('trans', {targetName: '中文'}).phases, ['润色原文', '翻译', '对齐时间轴']);
  assert.match(N.chainOf('clean', {}).doneToast, /审阅/);
});

test('西文语言名拼进句子时留空，中文名紧贴', () => {
  assert.equal(N.cta('trans', {targetName: 'English'}), '转录并翻译成 English');
  assert.equal(N.pipeline('trans', {targetName: 'English'})[2].label, '翻译成 English');
  assert.match(N.chainOf('trans', {targetName: 'English'}).doneToast, /English 字幕/);
  assert.match(N.chainOf('trans', {targetName: '中文'}).doneToast, /中文字幕/);
});

test('场景：那一句直接写进框里，跟在用户的话后面；换场景只换那一句，用户的话原样不动', () => {
  assert.deepEqual(N.SCENES.map((x) => x.k), ['trans', 'clean', 'sub', 'anim', 'board', 'math', 'sticker']);
  const mine = '这期嘉宾语速很快，注意断句';
  let c = N.applyScene({text: mine, auto: null, scene: null}, 'trans', {targetName: '日本語'});
  assert.equal(c.text, mine + '\n请转录以下内容并翻译字幕，翻译成日本語。');
  assert.deepEqual(N.autoRange(c.text, c.auto), [mine.length + 1, c.text.length]);
  c = N.applyScene(c, 'sub');
  assert.deepEqual([c.text, c.scene], [mine + '\n请转录以下内容并生成字幕。', 'sub']);
  c = N.applyScene(c, 'sub');                                  // 再点一次撤掉
  assert.deepEqual(c, {text: mine, auto: null, scene: null});
  assert.match(N.sceneText('trans'), /翻译成 English/);
  assert.deepEqual(N.applyScene(c, 'nope'), c);
});

test('场景：用户改过那一句（比如换语言）它就是用户的了，再点别的只在后面补，不删', () => {
  let c = N.applyScene({text: '', auto: null, scene: null}, 'trans');
  const edited = c.text.replace('English', '日本語');
  assert.equal(N.syncAuto(edited, c.auto), null);
  assert.equal(N.syncAuto(c.text + '\n另外保留语气词', c.auto), c.auto);   // 在后面接着写不算动它
  c = N.applyScene({text: edited, auto: null, scene: 'trans'}, 'clean');
  assert.ok(c.text.startsWith(edited + '\n请转录以下内容，再找出口癖'));
  c = N.applyScene({text: edited, auto: null, scene: 'trans'}, 'trans');  // 同一张再点：只灭掉，不动字
  assert.deepEqual(c, {text: edited, auto: null, scene: null});
});

test('场景：做新视频的场景——空框写个开头，有话就补在后面', () => {
  const a = N.applyScene({text: '', auto: null, scene: null}, 'board');
  assert.equal(a.text, '请做一条白板手绘教学动画，内容是：');
  assert.equal(N.stripAuto(a.text + '复利', a.auto), '复利');
  const b = N.applyScene({text: '讲复利', auto: null, scene: null}, 'board');
  assert.equal(b.text, '讲复利\n请把上面的内容做成一条白板手绘教学动画。');
});

test('场景：处理素材的场景没附素材时路线停在「要一条视频或音频」，附上就走 ask', () => {
  const r = N.route('', [], 'trans');
  assert.deepEqual([r.goal, r.by, r.media], ['ask', 'scene', null]);
  assert.match(N.routeNote(r), /转录并翻译.*视频或音频/);
  assert.equal(N.canStart('ask', {media: false}).ok, false);
  assert.equal(N.canStart('ask', {media: false, prompt: 'x'}).ok, true);   // 有话就能发，素材由 Agent 自己去要
  // 只点了磁贴：框里那句话是我们替他写的（`own` 为空），仍然拦着
  assert.equal(N.canStart('ask', {media: false, prompt: '请转录以下内容并翻译字幕。', own: ''}).ok, false);
  assert.equal(N.canStart('ask', {media: true, prompt: '请转录以下内容并翻译字幕。', own: ''}).ok, true);
  assert.equal(N.route('', [{name: 'a.mp4', kind: 'media'}], 'trans').by, 'media');
});

test('贴纸动画：句子里带 skill 认的原词「贴纸动画」，框空写开头、框里有话补在后面', () => {
  assert.equal(N.sceneText('sticker'), '请做一条贴纸动画，插画贴纸配着旁白一张张贴上去，内容是：');
  assert.equal(N.sceneText('sticker', {after: true}), '请把上面的内容做成一条贴纸动画，插画贴纸配着旁白一张张贴上去。');
  assert.equal(N.scene('sticker').media, false);
  assert.equal(N.scene('sticker').title, '贴纸动画');
  // 磁贴自己的说明和示例句猜回贴纸，不被别的类型的关键词截走
  const g = N.goal('sticker');
  assert.ok([g.desc].concat(g.examples).every((t) => N.route(t, []).goal === 'sticker'));
  assert.equal(N.route('把这份 PDF 做成产品介绍动画', []).goal, 'anim');
});

test('Shorts 是格式不是路线：竖屏数学短视频仍走数学、抖音贴纸短片仍走贴纸，只是多了 Shorts 那一层', () => {
  const S = global.window.BC_SHORTS || require('./model-shorts.js');
  const math = N.route('做一条竖屏数学短视频，讲导数', [], null);
  assert.equal(math.goal, 'math');
  assert.ok(S.detect('做一条竖屏数学短视频，讲导数'));
  assert.equal(N.routeNote(math, {shorts: true}), '看起来是「数学教学动画」，Agent 会用对应的制作 skill；按 Shorts 做');
  assert.equal(N.routeNote(math), '看起来是「数学教学动画」，Agent 会用对应的制作 skill');
  const st = N.route('抖音贴纸短片：乌龟长大', [], null);
  assert.equal(st.goal, 'sticker');
  assert.ok(S.detect('抖音贴纸短片：乌龟长大'));
  // 带素材的路线不补「按 Shorts 做」这句——带素材打开 Shorts 是切片版（shortsCut），见下一条
  assert.doesNotMatch(N.routeNote(N.route('', [{name: 'a.mp4', kind: 'media'}], null), {shorts: true}), /Shorts/);
});

test('带着视频切 Shorts（§7）：流程条是转录 + 切片版六步，路线说明写明每支一部新视频与来源片段', () => {
  const r = N.route('把这期切成三条 Shorts', [{name: 'ep42.mp4', kind: 'media'}], null);
  assert.equal(r.by, 'media');
  assert.equal(N.routeNote(r, {shortsCut: true}), '先给「ep42.mp4」建视频并转录，Agent 挑出有看点的段落，一支切成一部 9:16 新视频，并记下来源片段');
  assert.equal(N.routeNote(r), '先给「ep42.mp4」建视频并转录，Agent 等转录完再按这句话动手');
  assert.deepEqual(N.pipeline('ask', {shortsCut: true}).map((s) => s.label),
    ['转录', '读转录', '挑钩子段', '切段并换 9:16', '字幕与安全区', '发布前检查', '你来挑']);
  assert.equal(N.pipeline('ask', {shortsCut: true})[0].by, 'local');
  assert.deepEqual(N.pipeline('ask', {}).map((s) => s.k), ['transcribe', 'agent']);
});

test('Shorts：流程条换成六步，交代多一行，画幅锁 9:16、时长夹到两档', () => {
  assert.deepEqual(N.pipeline('math', {shorts: true}).map((s) => s.k), ['script', 'voice', 'build', 'sfx', 'check', 'review']);
  assert.deepEqual(N.pipeline('math', {}).map((s) => s.k), ['script', 'build', 'review']);
  assert.match(N.specLine({shorts: true, length: 'm'}), /^按 Shorts 做：9:16，约 1 分钟；/);
});

test('Shorts 记忆：亲手开过的下次接着开；亲手关掉就忘；猜出来的不记', () => {
  assert.equal(N.seed({}).shorts, null);
  const on = N.remember({}, {entry: 'agent', shorts: true});
  assert.equal(N.seed(on).shorts, true);
  const off = N.remember(on, {entry: 'agent', shorts: false});
  assert.equal('shorts' in off, false);
  assert.equal(N.seed(off).shorts, null);
  assert.equal(N.remember(on, {entry: 'agent', shorts: null}).shorts, true);
});

test('时长：预设键与五秒档位换成秒和「约 …」', () => {
  assert.equal(N.lengthSeconds('s'), 30);
  assert.equal(N.lengthSeconds('m'), 60);
  assert.equal(N.lengthSeconds('l'), 180);
  assert.equal(N.lengthLabel('90s'), '约 1 分钟 30 秒');
  assert.equal(N.lengthLabel('600s'), '约 10 分钟');
  for (const key of ['auto', '0s', '6s', '605s', 'invalid', 'constructor', null]) assert.equal(N.lengthSeconds(key), null);
});

test('交给 Agent 的话：没填的占位符写成 [label]，填过的就是普通文字（template-spec §5.5）', () => {
  assert.equal(N.homePrompt('给{{产品或服务}}做一条推广，面向{{受众}}。', {title: '推广短片'}, {}),
    '给[产品或服务]做一条推广，面向[受众]。\n模板：推广短片');
  assert.equal(N.homePrompt('给降噪耳机做一条推广，面向{{受众}}。', null, {}), '给降噪耳机做一条推广，面向[受众]。');
  assert.equal(N.homePrompt('没闭合的 {{受众', null, {}), '没闭合的 {{受众');
});

test('快捷开始：四条都对应媒体目标，提示词是一句话；带着素材一律走 ask，没附素材也不会被猜成某一类制作', () => {
  const list = N.homeStarters();
  assert.deepEqual(list.map((x) => x.k), ['sub', 'trans', 'clean', 'a2v']);
  for (const x of list) {
    const g = N.GOALS.find((goal) => goal.k === x.goal);
    assert.ok(g && g.entry === 'media' && !g.agentOnly, x.k);
    assert.deepEqual([x.title, x.icon], [g.title, g.icon], x.k);
    assert.match(x.prompt, /^[^\n！!]+。$/, x.k);
    assert.match(x.tip, /^填入提示词，再把(视频|音频)拖进输入框，或贴上(视频链接|链接)$/, x.k);
    /* route 对带素材的输入不看措辞：先建视频并转录，再由 Agent 按这句话做（goal 恒为 ask）。 */
    const name = x.goal === 'a2v' ? 'x.mp3' : 'x.mp4';
    const withMedia = N.route(x.prompt, [{name, kind: 'media'}], null);
    assert.deepEqual([withMedia.goal, withMedia.by, withMedia.media], ['ask', 'media', name], x.k);
    assert.deepEqual(N.canStart(withMedia.goal, {media: true, prompt: x.prompt, own: x.prompt, gate: {ok: true}}), {ok: true}, x.k);
    const bare = N.route(x.prompt, [], null);
    assert.deepEqual([bare.goal, bare.by], ['free', 'none'], x.k);
  }
  assert.equal(N.starter('sub').prompt, '给这个视频加上字幕。');
  assert.equal(N.starter('sub').tip, '填入提示词，再把视频拖进输入框，或贴上视频链接');
  assert.equal(N.starter('trans').prompt, '转录这个视频，并翻译成{{目标语言}}，做成双语字幕。');
  assert.equal(N.starter('trans', {targetName: 'English'}).prompt, '转录这个视频，并翻译成 English，做成双语字幕。');
  assert.equal(N.starter('trans', {targetName: '日语'}).prompt, '转录这个视频，并翻译成日语，做成双语字幕。');
  assert.equal(N.starter('a2v').tip, '填入提示词，再把音频拖进输入框，或贴上链接');
  assert.equal(N.starter('ask'), null);
  assert.equal(N.starter('blank'), null);
});

test('快捷开始「转录并翻译」：目标语言没有缺省，没填过留待填项，发出去前不猜（开发流程 §4）', () => {
  require('./model-prompt-slots.js');
  const tpl = N.starter('trans').prompt;
  assert.equal(N.homePrompt(tpl, null, {}), '转录这个视频，并翻译成[目标语言]，做成双语字幕。');
  /* 认出用户填的语言，下次沿用；还是占位符、或那句话改得认不出时不记 */
  assert.equal(N.starterTarget('转录这个视频，并翻译成日语，做成双语字幕。'), '日语');
  assert.equal(N.starterTarget('转录这个视频，并翻译成 English，做成双语字幕。https://example.com/v/1'), 'English');
  assert.equal(N.starterTarget(tpl), null);
  assert.equal(N.starterTarget('给这个视频加上字幕。'), null);
  assert.equal(N.starterTarget(''), null);
  let m = N.remember({}, {entry: 'agent', targetName: N.starterTarget('转录这个视频，并翻译成法语，做成双语字幕。')});
  assert.equal(N.seed(m).targetName, '法语');
  m = N.remember(m, {entry: 'agent', targetName: null});
  assert.equal(N.seed(m).targetName, '法语', '这一次没认出来不冲掉上次的');
  assert.equal(N.starter('trans', {targetName: N.seed(m).targetName}).prompt, '转录这个视频，并翻译成法语，做成双语字幕。');
});

test('起始页的项目：记上次选的，选「不用项目」记 null；别的记忆不动它', () => {
  let m = N.remember({}, {dir: 'd3'});
  assert.equal(N.seed(m).dir, 'd3');
  m = N.remember(m, {entry: 'agent', picked: null, shorts: null});
  assert.equal(N.seed(m).dir, 'd3');
  m = N.remember(m, {dir: null});
  assert.equal(N.seed(m).dir, null);
  assert.equal(N.seed({dir: 42}).dir, null);
});

test('话里的链接：认 http / https，止于空白与中文标点', () => {
  assert.equal(N.linkIn('转录这个视频 https://www.youtube.com/watch?v=abc123，做成字幕'), 'https://www.youtube.com/watch?v=abc123');
  assert.equal(N.linkIn('http://x.com/a/status/1'), 'http://x.com/a/status/1');
  assert.equal(N.linkIn('给这个视频加上字幕。'), null);
  assert.equal(N.linkIn(''), null);
});
