const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-skills.js');
require('./model-skill-package.js');
const P = global.window.BC_SKILL_PKG;

const md = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

test('文件分类：SKILL.md、文档、素材、脚本各归各类', () => {
  assert.equal(P.fileKind('SKILL.md'), 'skill');
  assert.equal(P.fileKind('references/a.md'), 'doc');
  assert.equal(P.fileKind('assets/seal.svg'), 'svg');
  assert.equal(P.fileKind('assets/logo.PNG'), 'image');
  assert.equal(P.fileKind('assets/intro.mp3'), 'audio');
  assert.equal(P.fileKind('fonts/a.woff2'), 'font');
  assert.equal(P.fileKind('scripts/render.mjs'), 'script');
  assert.equal(P.fileKind('scripts/align.py'), 'script');
  assert.equal(P.fileKind('brand.json'), 'data');
  assert.equal(P.fileKind('LICENSE'), 'other');
  assert.ok(P.isAsset('assets/seal.svg') && !P.isAsset('brand.json'));
});

test('素材清单与一行摘要：svg 与图片合并计数', () => {
  const skill = {files: [{path: 'SKILL.md', body: 'x'}, {path: 'assets/seal.svg', body: '<svg/>'}, {path: 'assets/logo.png', size: 2048},
    {path: 'assets/intro.mp3', size: 300000}, {path: 'assets/outro.mp3', size: 300000}, {path: 'scripts/a.mjs', body: ''}]};
  assert.deepEqual(P.assets(skill).map((a) => a.kind), ['image', 'svg', 'audio', 'audio']);
  const st = P.stats(skill);
  assert.equal(st.assetLine, '2 张图片 · 2 段音频');
  assert.deepEqual(st.scripts, ['scripts/a.mjs']);
  assert.equal(st.files, 6);
  assert.equal(P.bytesLabel(1024 * 1024 * 1.25), '1.3 MB');
  assert.equal(P.bytesLabel(2048), '2 KB');
});

test('上传的包：根目录有 SKILL.md 就是一个 skill，隐藏与系统文件略过', () => {
  const r = P.parsePackage({name: 'brand.zip', entries: [
    {path: 'SKILL.md', body: md('lin-brand', '品牌规则')}, {path: 'assets/seal.svg', body: '<svg/>'},
    {path: '__MACOSX/._SKILL.md', size: 10}, {path: '.DS_Store', size: 10}]});
  assert.ok(r.ok);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].skill.id, 'lin-brand');
  assert.deepEqual(r.candidates[0].skill.files.map((f) => f.path), ['SKILL.md', 'assets/seal.svg']);
  assert.deepEqual(r.ignored.sort(), ['.DS_Store', '__MACOSX/']);
});

test('插件包：skills/<名字>/ 下的每个 SKILL.md 是一个候选，路径去掉前缀；嵌套的 SKILL.md 归外层', () => {
  const r = P.parsePackage({name: 'kit.zip', entries: [
    {path: '.claude-plugin/plugin.json', body: '{}'},
    {path: 'skills/a/SKILL.md', body: md('a', 'A')}, {path: 'skills/a/refs/x.md', body: 'x'},
    {path: 'skills/a/examples/demo/SKILL.md', body: md('demo', 'D')},
    {path: 'skills/b/SKILL.md', body: md('b', 'B')}]});
  assert.ok(r.ok);
  assert.deepEqual(r.candidates.map((c) => c.skill.id), ['a', 'b']);
  assert.deepEqual(r.candidates[0].skill.files.map((f) => f.path), ['SKILL.md', 'refs/x.md', 'examples/demo/SKILL.md']);
  assert.deepEqual(r.ignored, ['.claude-plugin/']);
});

test('上传的包：没有 SKILL.md、缺 description、超上限都如实说明', () => {
  assert.equal(P.parsePackage({entries: [{path: 'README.md', body: '#'}]}).ok, false);
  const noDesc = P.parsePackage({entries: [{path: 'SKILL.md', body: '---\nname: x\n---\n'}]});
  assert.match(noDesc.candidates[0].error, /description/);
  const big = P.parsePackage({entries: [{path: 'SKILL.md', body: md('x', 'y')}, {path: 'a.mp4', size: 9 * 1024 * 1024}]});
  assert.match(big.candidates[0].error, /太大/);
});

test('撞名：个人 skill 可以更新为新版本，内置的只能另存为副本', () => {
  const list = [{id: 'a', source: 'personal', version: 3}, {id: 'b', source: 'builtin'}];
  assert.deepEqual(P.conflictOf(list, {id: 'a'}).canUpdate, true);
  assert.equal(P.conflictOf(list, {id: 'a'}).nextVersion, 4);
  assert.equal(P.conflictOf(list, {id: 'b'}).canUpdate, false);
  assert.equal(P.conflictOf(list, {id: 'c'}), null);
});

test('装进来：新的排最前；更新产生新版本并保留旧版本；副本换 id 与名字', () => {
  const cand = {skill: {id: 'a', name: 'A', description: 'd', files: [{path: 'SKILL.md', body: md('A2', 'd2')}]}};
  const base = [{id: 'a', name: 'A', source: 'personal', version: 1, updated: '2026-10-01', files: [{path: 'SKILL.md', body: md('A', 'd')}]}];
  const up = P.install(base, cand, 'update', 'a.zip');
  const s = up.list[0];
  assert.equal(s.version, 2);
  assert.equal(s.name, 'A');   // 名字不跟着 SKILL.md 的 name 变
  assert.equal(s.description, 'd2');
  assert.deepEqual(P.versions(s).map((v) => v.n), [2, 1]);
  assert.match(P.filesAt(s, 1)[0].body, /name: A\n/);
  assert.equal(s.origin, 'a.zip');
  const cp = P.install(base, cand, 'copy', 'a.zip');
  assert.equal(cp.id, 'a-2');
  assert.equal(cp.list[0].name, 'A 副本');
  assert.equal(cp.list.length, 2);
  const fresh = P.install([], {skill: {id: 'z', name: 'Z', description: 'd', files: [{path: 'SKILL.md', body: ''}, {path: 'logo.svg', body: '<svg/>'}]}}, 'new');
  assert.equal(fresh.list[0].category, '品牌');
  assert.equal(fresh.list[0].source, 'personal');
});

test('复制内置 skill 到「我的」；新建空白 skill 带 SKILL.md 模板', () => {
  const list = [{id: 'cap', name: '字幕', summary: 's', source: 'builtin', files: [{path: 'SKILL.md', body: 'x'}]}];
  const d = P.duplicate(list, 'cap');
  assert.equal(d.id, 'cap-2');
  assert.equal(d.list[0].source, 'personal');
  assert.equal(d.list[0].summary, undefined);
  const b = P.blank(list, '片尾致谢', '加片尾时用');
  assert.equal(P.frontMatter(b.list[0].files[0].body).description, '加片尾时用');
  assert.equal(b.id, 'my-skill');   // 中文名取不出 id，用兜底；列表上的名字照旧
  assert.equal(b.list[0].name, '片尾致谢');
  assert.equal(P.frontMatter(b.list[0].files[0].body).name, 'my-skill');
  assert.equal(P.slug('Lin Explains · 品牌'), 'lin-explains');
  assert.ok(P.blank(list, ' ').error);
});

test('列表分两段：我的（个人与第三方）、BaoCut 内置；搜索沿用 BC_AGENT_SKILLS', () => {
  const list = [{id: 'a', name: '品牌', source: 'personal'}, {id: 'b', name: '字幕', source: 'builtin'}, {id: 'c', name: '社区', source: 'third-party'}];
  assert.deepEqual(P.sections(list, '').map((s) => s.items.map((x) => x.id)), [['a', 'c'], ['b']]);
  assert.deepEqual(P.sections(list, '字幕').map((s) => s.items.length), [0, 1]);
  assert.equal(P.iconName('字幕'), 'CloseCaptions');
  assert.equal(P.iconName('没有的'), 'Lightbulb');
  assert.equal(P.dateLabel({updated: '2026-10-14'}), '10 月 14 日');
});
