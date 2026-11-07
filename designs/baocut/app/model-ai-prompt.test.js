const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-ai-prompt.js');
const P = window.BC_AIPROMPT;

test('列表：「画面」组排第一，接着是从文稿出发的三组；画面组只开剪成短视频，智能裁剪另有去处说明', () => {
  assert.deepEqual(P.GROUPS_NOW, ['画面', '整理文稿', '写作', '发布', '声音']);
  assert.deepEqual(P.listed('声音', ['soundtrack']), ['soundtrack']);
  assert.deepEqual(P.GROUPS_LATER, ['翻译']);
  assert.deepEqual(P.listed('画面', ['crop', 'shortscut']), ['shortscut']);
  assert.deepEqual(P.listed('写作', ['summary', 'blog']), ['summary', 'blog']);
  assert.match(P.LATER_NOTE, /智能裁剪/);
  assert.ok(!/剪成短视频/.test(P.LATER_NOTE));
  assert.match(P.LATER_NOTE, /之后搬到这里/);
});

test('剪成短视频的模板：意图句之后参数一行一句，最后一行是可删的「直接创建」', () => {
  const t = P.template('shortscut', '把「A」剪成几支短视频。', {extra: ['要 3 支，每支 30–60 秒', '找好就直接创建成视频，不用先问我']});
  assert.deepEqual(t.split('\n'), ['把「A」剪成几支短视频。', '要 3 支，每支 30–60 秒', '找好就直接创建成视频，不用先问我']);
  assert.equal(P.TOOL_SKILL.shortscut, 'shorts-segments');
});

test('模板 = 意图句 + 固定约束；写作类带 Markdown 与语言，整理类不带', () => {
  const t = P.template('summary', '从「A」的文稿提炼一份带时间码的要点总结。', {lang: '中文'});
  const lines = t.split('\n');
  assert.equal(lines[0], '从「A」的文稿提炼一份带时间码的要点总结。');
  assert.match(t, /Markdown/);
  assert.match(t, /中文/);
  assert.match(t, /mm:ss/);
  const p = P.template('polish', '润色。', {lang: '中文'});
  assert.ok(!/Markdown/.test(p));
  assert.match(p, /不改写我的表达/);
  // 空意图句不留空行
  assert.equal(P.template('cleanup', '', {}), '');
});

test('每个工具都有一句「会不会改视频」', () => {
  ['polish', 'chapters', 'speakers', 'retranscribe', 'cleanup', 'stale', 'summary', 'blog', 'title', 'desc', 'cover']
    .forEach((k) => assert.ok(P.EFFECT[k], k));
  assert.match(P.EFFECT.summary, /不改视频/);
  assert.match(P.EFFECT.polish, /撤销/);
});

test('每个第一批工具都配一个内置 skill；默认挂它，列表里没有就不挂', () => {
  // data.js 要先有这些模型；换一个 window 装，不碰上面的 P
  const saved = global.window; global.window = {};
  ['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
    .forEach((m) => require(`./model-${m}.js`));
  require('./data.js');
  require('./model-agent-skills.js');
  const list = window.BC_DATA.agentSkills;
  const K = window.BC_AGENT_SKILLS;
  global.window = saved;
  ['polish', 'chapters', 'speakers', 'retranscribe', 'cleanup', 'stale', 'summary', 'blog', 'title', 'desc', 'cover', 'shortscut']
    .forEach((k) => {
      const id = P.TOOL_SKILL[k];
      assert.ok(id, k);
      const s = K.byId(list, id);
      assert.ok(s && s.source === 'builtin', `${k} → ${id}`);
      assert.deepEqual(P.defaultSkills(k, list), [id]);
    });
  assert.deepEqual(P.defaultSkills('polish', []), []);
  assert.deepEqual(P.defaultSkills('nope', list), []);
  const items = P.contextPack('summary', {paras: 3, skills: ['视频内容总结']});
  assert.match(P.contextLine(items), /Skill 视频内容总结$/);
});

test('上下文包按工具取材，折成一行', () => {
  const items = P.contextPack('summary', {paras: 42, words: 6200, chapters: 4, attachments: 1});
  assert.deepEqual(items.map((i) => i.k), ['transcript', 'chapters', 'attachments']);
  assert.match(P.contextLine(items), /^发给模型的：提示词 \+ 文稿 42 段 · 约 6,200 字/);
  const cover = P.contextPack('cover', {paras: 42, frames: 6});
  assert.equal(cover[0].k, 'frames');
  const scoped = P.contextPack('polish', {paras: 9, scope: '第 2 章 · 现场访谈'});
  assert.equal(scoped[0].label, '文稿 · 第 2 章 · 现场访谈');
  assert.equal(P.contextLine([]), '发给模型的：只有上面的提示词');
});

test('会话去向缺省新会话；这部视频有过会话时才给「接着」', () => {
  const none = P.sessionOptions([{id: 's1', project: 'other', messages: [{}]}], 'p1');
  assert.deepEqual(none.options.map((o) => o.k), ['new']);
  assert.equal(none.dflt, 'new');
  const has = P.sessionOptions([{id: 's9', project: 'p1', title: '剪口癖', messages: [{}, {}]}, {id: 's1', project: 'p1', messages: [{}]}], 'p1');
  assert.deepEqual(has.options.map((o) => o.k), ['new', 'current']);
  assert.equal(has.options[1].sid, 's9');
  assert.match(has.options[1].label, /剪口癖/);
  assert.match(has.options[1].sub, /2 条消息/);
  // 还没说过话的空会话不算
  const empty = P.sessionOptions([{id: 's2', project: 'p1', messages: []}], 'p1');
  assert.equal(empty.options.length, 1);
});

test('hint 随谁来做与去向变', () => {
  assert.match(P.hint({agent: true, session: 'new'}), /^新开一条会话/);
  assert.match(P.hint({agent: true, session: 'current'}), /^发到这部视频当前的会话/);
  assert.match(P.hint({agent: false, model: 'gpt-4o', readonly: true, cloud: true}), /直接调 gpt-4o.*不写进视频.*按用量计费/);
  assert.match(P.hint({agent: false, model: 'qwen', readonly: false, cloud: false}), /完成即应用.*不出本机/);
});

test('结果页的「返回」回参数页，参数页与进度页的「返回」回列表', () => {
  ['done', 'confirm', 'gallery'].forEach((ph) => assert.equal(P.backTarget(ph), 'setup'));
  ['setup', 'run', 'agent', 'download', undefined].forEach((ph) => assert.equal(P.backTarget(ph), 'list'));
});

test('交给 Agent 后缺省离开工具页；找可剪的口与刷新过期译文留在原地', () => {
  ['summary', 'blog', 'desc', 'title', 'cover', 'polish', 'chapters', 'speakers', 'translate', 'shortscut'].forEach((t) => assert.equal(P.agentLeavesPage(t), true, t));
  assert.equal(P.agentLeavesPage('cleanup'), false);
  assert.equal(P.agentLeavesPage('stale'), false);
});

test('刷新过期译文直接调模型：计数折成一行与主按钮，零的那类不写', () => {
  assert.deepEqual(P.staleDirect({stale: 3, untranslated: 2}), {todo: 5, line: '要重译：3 过期 · 2 未翻译', cta: '重译 5 句'});
  assert.equal(P.staleDirect({stale: 0, untranslated: 2}).line, '要重译：2 未翻译');
  assert.deepEqual(P.staleDirect({}), {todo: 0, line: '这份译文没有过期或还没翻译的句子', cta: '重译'});
});

test('按主题与系列写作：上下文那一行写明挑了几段、覆盖几章、几部视频（embedding §2.2）', () => {
  const items = P.contextPack('blog', {paras: 62, topic: {paras: 12, chapters: 3}, chapters: 4, skills: ['写博客']});
  assert.equal(P.contextLine(items), '发给模型的：提示词 + 文稿 12 段（按主题挑选，覆盖 3 章） · 章节 4 章 · Skill 写博客');
  const series = P.contextPack('blog', {paras: 120, series: 2});
  assert.match(P.contextLine(series), /系列 2 部视频的文稿/);
});

test('写作结果带出处、存进 Space（embedding §2.1）', () => {
  assert.match(P.EFFECT.blog, /Space.*出处/);
  assert.ok(P.standing('blog', {}).includes(P.CITE_RULE));
  assert.ok(P.standing('summary', {}).includes(P.CITE_RULE));
  assert.ok(!P.standing('title', {}).includes(P.CITE_RULE));
  assert.match(P.hint({model: 'm', readonly: true, saved: true}), /存成 Space 里的一份文档，不写进视频/);
});
