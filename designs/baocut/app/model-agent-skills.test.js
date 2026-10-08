const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-agent-skills.js');
const K = window.BC_AGENT_SKILLS;
const DEMO = window.BC_DATA.agentSkills;
const FOLDERS = window.BC_DATA.agentSkillFolders;

const list = () => [
  {id: 'a', name: '字幕排版', summary: '整理字幕', source: 'builtin', author: 'BaoCut', category: '字幕', enabled: true, updated: '2026-09-28', files: [{path: 'SKILL.md', body: ''}]},
  {id: 'b', name: '双语校对', summary: '核对译文', source: 'builtin', author: 'BaoCut', category: '字幕', enabled: false, updated: '2026-09-01', files: []},
  {id: 'c', name: '频道片头', summary: '加片头', source: 'personal', author: '你', category: '品牌', enabled: true, updated: '刚刚', files: []},
  {id: 'd', name: '章节标记', summary: '分章节', source: 'third-party', author: '示例作者 A', category: '社区', enabled: false, updated: '2026-08-30', files: []},
];

test('演示数据：7–9 条，三种来源都有，每条有 SKILL.md 与 frontmatter，至少两条带 references/；第三方默认关', () => {
  assert.ok(DEMO.length >= 7 && DEMO.length <= 9);
  assert.equal(new Set(DEMO.map((s) => s.id)).size, DEMO.length);
  K.SOURCES.forEach((s) => assert.ok(DEMO.some((x) => x.source === s.k), s.k));
  DEMO.forEach((s) => {
    const doc = s.files.find((f) => f.path === 'SKILL.md');
    assert.ok(doc, s.id);
    const v = K.fileBlocks(doc.body);
    assert.match(v.frontmatter, /^name: .+\ndescription: .+$/, s.id);
    assert.ok(v.blocks.some((b) => b.type === 'h1') && v.blocks.some((b) => b.type === 'ol'), s.id);
    assert.ok(s.name && s.summary && s.description && s.author && s.category && Array.isArray(s.examples), s.id);
    assert.match(s.updated, /^\d{4}-\d{2}-\d{2}$/);
  });
  assert.ok(DEMO.filter((s) => s.files.some((f) => f.path.startsWith('references/'))).length >= 2);
  assert.ok(DEMO.filter((s) => s.source === 'third-party').every((s) => !s.enabled));
});

test('筛选与搜索：页签按来源，搜索看名称、描述、作者与分类；计数跟着搜索走', () => {
  const l = list();
  assert.deepEqual(K.find(l, '', 'all').map((s) => s.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(K.find(l, '', 'builtin').map((s) => s.id), ['a', 'b']);
  assert.deepEqual(K.find(l, ' 字幕 ', 'all').map((s) => s.id), ['a', 'b']);
  assert.deepEqual(K.find(l, '示例作者', 'third-party').map((s) => s.id), ['d']);
  assert.deepEqual(K.find(l, '字幕', 'personal'), []);
  assert.deepEqual(K.counts(l), {all: 4, builtin: 2, personal: 1, 'third-party': 1});
  assert.deepEqual(K.counts(l, '字幕'), {all: 2, builtin: 2, personal: 0, 'third-party': 0});
});

test('开关只改 enabled；添加排最前且拒绝重复；移除拒绝内置', () => {
  const l = list();
  assert.equal(K.byId(K.toggle(l, 'b'), 'b').enabled, true);
  assert.equal(K.byId(K.toggle(l, 'a', true), 'a').enabled, true);
  assert.equal(K.byId(K.toggle(l, 'a', false), 'a').enabled, false);
  assert.equal(l[0].enabled, true);
  const added = K.add(l, {id: 'e', name: '新的'});
  assert.equal(added.list[0].id, 'e');
  assert.match(K.add(l, {id: 'a', name: '字幕排版'}).error, /已经添加过/);
  assert.ok(K.add(l, {}).error);
  assert.match(K.remove(l, 'a').error, /内置 skill 不能移除/);
  assert.equal(K.remove(l, 'a').list, l);
  assert.deepEqual(K.remove(l, 'c').list.map((s) => s.id), ['a', 'b', 'd']);
  assert.ok(K.remove(l, 'nope').error);
});

test('输入框菜单：全部已添加的都在，开着的在前，描述截成一行', () => {
  const l = list();
  assert.deepEqual(K.menuItems(l).map((s) => s.id), ['a', 'c', 'b', 'd']);
  const long = K.menuItems([{id: 'x', name: 'X', summary: '很'.repeat(60), enabled: true}])[0];
  assert.equal(long.desc.length, 20);
  assert.ok(long.desc.endsWith('…'));
  assert.deepEqual(K.menuItems([]), []);
});

test('选用的 skill 在提示词末尾带一行', () => {
  const s = list()[0];
  assert.equal(K.promptLine(s), '使用 skill：字幕排版');
  assert.equal(K.withSkill('重排字幕', s), '重排字幕\n使用 skill：字幕排版');
  assert.equal(K.withSkill('', s), '使用 skill：字幕排版');
  assert.equal(K.withSkill('重排字幕', null), '重排字幕');
});

test('来源与更新时间一行', () => {
  assert.equal(K.metaLine(list()[0]), '内置 · 更新于 9 月 28 日');
  assert.equal(K.metaLine(list()[2]), '我的 · 刚刚更新');
  assert.equal(K.metaLine(list()[3]), '第三方 · 更新于 8 月 30 日');
});

test('GitHub 地址：认 owner/repo 与带 tree 的完整地址，其余给错误文案', () => {
  assert.deepEqual(K.parseGithub('owner/repo'), {ok: true, owner: 'owner', repo: 'repo', branch: null, path: '', name: 'repo', url: 'https://github.com/owner/repo'});
  assert.equal(K.parseGithub(' https://github.com/owner/repo.git/ ').repo, 'repo');
  const deep = K.parseGithub('https://github.com/owner/my-skills/tree/main/skills/chapter-marks');
  assert.deepEqual([deep.owner, deep.repo, deep.branch, deep.path, deep.name], ['owner', 'my-skills', 'main', 'skills/chapter-marks', 'chapter-marks']);
  assert.equal(K.parseGithub('github.com/owner/repo/tree/dev').branch, 'dev');
  ['', 'owner', 'owner/', 'https://example.com/owner/repo', 'https://github.com/owner', 'https://github.com/owner/repo/issues/3',
    'owner/re po', 'https://github.com/owner/repo/tree', 'example.com/owner/repo'].forEach((bad) => {
    const r = K.parseGithub(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error, bad);
  });
});

test('从 GitHub 导入的是第三方、默认关、带 SKILL.md；同一仓库不能加两次', () => {
  const r = K.fromGithub(K.parseGithub('owner/repo'), list());
  assert.equal(r.skill.source, 'third-party');
  assert.equal(r.skill.enabled, false);
  assert.equal(r.skill.files[0].path, 'SKILL.md');
  assert.match(K.fromGithub(K.parseGithub('Owner/Repo'), [r.skill]).error, /已经添加过/);
  assert.ok(K.fromGithub(K.parseGithub('nope'), []).error);
});

test('从本地文件夹添加：要有 SKILL.md；加进来归「我的」、默认开；重复拒绝', () => {
  const ok = K.fromFolder(FOLDERS[0], DEMO);
  assert.equal(ok.skill.source, 'personal');
  assert.equal(ok.skill.enabled, true);
  assert.equal(ok.skill.origin, FOLDERS[0].path);
  assert.match(K.fromFolder(FOLDERS.find((f) => !f.skill), DEMO).error, /没有 SKILL\.md/);
  assert.match(K.fromFolder({path: '~/x/', skill: {id: 'x', name: 'X', files: [{path: 'README.md', body: ''}]}}, []).error, /没有 SKILL\.md/);
  assert.match(K.fromFolder(FOLDERS[0], [ok.skill]).error, /已经添加过/);
  assert.ok(K.fromFolder(null, []).error);
});

test('文件树：SKILL.md 在最前，文件夹只出现一次并带层级', () => {
  const tree = K.fileTree({files: [{path: 'references/b.md'}, {path: 'SKILL.md'}, {path: 'references/a.md'}]});
  assert.deepEqual(tree.map((n) => [n.kind, n.path, n.depth]), [
    ['file', 'SKILL.md', 0], ['dir', 'references', 0], ['file', 'references/a.md', 1], ['file', 'references/b.md', 1]]);
  assert.deepEqual(K.fileTree(null), []);
});

test('文件内容：frontmatter 单独取出，正文拆成标题、列表、代码块与段落', () => {
  const v = K.fileBlocks('---\nname: x\ndescription: y\n---\n\n# 标题\n\n一段\n接着\n\n- 甲\n1. 乙\n\n```\ncode\n```\n## 小节');
  assert.equal(v.frontmatter, 'name: x\ndescription: y');
  assert.deepEqual(v.blocks, [{type: 'h1', text: '标题'}, {type: 'p', text: '一段 接着'}, {type: 'li', n: undefined, text: '甲'},
    {type: 'ol', n: 1, text: '乙'}, {type: 'code', text: 'code'}, {type: 'h2', text: '小节'}]);
  assert.equal(K.fileBlocks('没有 frontmatter').frontmatter, null);
});

test('持久化只存差量：开关、添加、移除往返一致；内置永远在；坏数据回到演示数据', () => {
  let l = K.toggle(DEMO, DEMO[0].id, false);
  const personal = DEMO.find((s) => s.source === 'personal');
  l = K.remove(l, personal.id).list;
  l = K.add(l, K.fromGithub(K.parseGithub('owner/repo'), l).skill).list;
  const saved = JSON.parse(JSON.stringify(K.snapshot(DEMO, l)));
  assert.deepEqual(saved.enabled, {[DEMO[0].id]: false});
  assert.deepEqual(saved.removed, [personal.id]);
  assert.equal(saved.added.length, 1);
  assert.deepEqual(K.apply(DEMO, saved), JSON.parse(JSON.stringify(l)));
  assert.deepEqual(K.snapshot(DEMO, DEMO), {enabled: {}, added: [], removed: []});
  assert.deepEqual(K.apply(DEMO, null), DEMO);
  assert.deepEqual(K.apply(DEMO, {enabled: 'x', added: [null, {id: DEMO[0].id, name: '撞名'}], removed: [DEMO[0].id]}), DEMO);
});
