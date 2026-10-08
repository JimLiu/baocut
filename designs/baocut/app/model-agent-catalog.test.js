const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent-setup.js');
require('./model-agent.js');
require('./model-agent-catalog.js');
const S = window.BC_AGENT_SETUP;
const AG = window.BC_AGENT;
const C = window.BC_AGENT_CATALOG;

const catalog = [
  {id: 'goose', name: 'goose', ver: '1.33.1', desc: '开源、可扩展的本地智能体。', command: ['goose', 'acp'], docs: 'https://example.test/goose'},
  {id: 'auggie', name: 'Auggie CLI', ver: '0.33.0', desc: '长于在大型代码库里检索上下文。', command: ['npx', '-y', '@augmentcode/auggie@0.33.0', '--acp'], env: {AUGMENT_DISABLE_AUTO_UPDATE: '1'}},
  {id: 'fast-agent', name: 'fast-agent', ver: '0.9.22', desc: '可接多家模型服务。', command: ['uvx', '--from', 'fast-agent-acp==0.9.22', 'fast-agent-acp', '-x']},
];
const mark = (h) => ({...h, blocked: S.blocked(h)});

test('目录搜索：每个词都要在名字、id、介绍或命令里出现，不分大小写；已添加的打标', () => {
  assert.deepEqual(C.searchCatalog(catalog, '', []).map((e) => e.id), ['goose', 'auggie', 'fast-agent']);
  assert.deepEqual(C.searchCatalog(catalog, 'AUGGIE', []).map((e) => e.id), ['auggie']);
  assert.deepEqual(C.searchCatalog(catalog, '代码库', []).map((e) => e.id), ['auggie']);
  assert.deepEqual(C.searchCatalog(catalog, 'uvx', []).map((e) => e.id), ['fast-agent']);
  assert.deepEqual(C.searchCatalog(catalog, 'npx acp', []).map((e) => e.id), ['auggie']);
  assert.deepEqual(C.searchCatalog(catalog, 'goose 不存在', []), []);
  assert.deepEqual(C.searchCatalog(catalog, '  ', ['goose']).map((e) => e.added), [true, false, false]);
});

test('命令按空白拆，引号里的一段算一个参数；环境变量每行 KEY=VALUE', () => {
  assert.deepEqual(C.splitCommand('  my-agent   --acp '), ['my-agent', '--acp']);
  assert.deepEqual(C.splitCommand('agent --config "~/My Agents/a.toml" \'x y\''), ['agent', '--config', '~/My Agents/a.toml', 'x y']);
  assert.deepEqual(C.splitCommand(''), []);
  assert.deepEqual(C.parseEnv('A=1\n\n B_2 = two words \nC='), {env: {A: '1', B_2: 'two words', C: ''}, bad: null});
  assert.equal(C.parseEnv('A=1\nnot-a-pair').bad, 2);
  assert.equal(C.parseEnv('=1').bad, 1);
  assert.equal(C.parseEnv('1A=x').bad, 1);
});

test('自定义命令校验：id 小写字母开头、只用 a-z0-9-、不撞已有；名字与命令必填；不收管道与 &&', () => {
  const ok = {id: 'my-agent', name: '我的 Agent', command: 'my-agent --acp', env: ''};
  assert.deepEqual(C.validateCustom(ok, ['claude']), {});
  assert.equal(C.hasErrors(C.validateCustom(ok, [])), false);
  const empty = C.validateCustom({}, []);
  assert.deepEqual(Object.keys(empty).sort(), ['command', 'id', 'name']);
  for (const id of ['1agent', 'My-agent', 'my_agent', '-a', 'agent!']) assert.match(C.validateCustom({...ok, id}, []).id, /小写字母开头/, id);
  assert.match(C.validateCustom({...ok, id: 'a'.repeat(41)}, []).id, /最长 40/);
  assert.match(C.validateCustom({...ok, id: 'goose'}, ['goose'], {goose: 'goose'}).id, /已经有一个 Agent 用了「goose」，/);
  assert.match(C.validateCustom({...ok, id: 'claude'}, ['claude'], {claude: 'Claude Code'}).id, /「claude」（Claude Code）/);
  assert.match(C.validateCustom({...ok, name: '   '}, []).name, /名字/);
  assert.match(C.validateCustom({...ok, command: 'my-agent --acp | tee log'}, []).command, /只填一条命令/);
  assert.match(C.validateCustom({...ok, command: 'a && b'}, []).command, /只填一条命令/);
  assert.match(C.validateCustom({...ok, env: 'OK=1\nbad line'}, []).env, /第 2 行/);
});

test('目录条目变成一家还没检测的 provider：added、启动命令与环境变量照抄，没有模型；npx / uvx 记下包名', () => {
  const g = C.fromCatalog(catalog[0]);
  assert.equal(g.added, 'catalog');
  assert.deepEqual([g.found, g.models.length, g.launcher, g.cmd], [false, 0, null, 'goose']);
  assert.equal(S.health(g), 'missing');
  assert.equal(S.badge(g).label, '还没检测');
  const a = C.fromCatalog(catalog[1]);
  assert.deepEqual([a.launcher, a.spec, a.launcherNeeds], ['npx', '@augmentcode/auggie@0.33.0', 'Node.js']);
  assert.equal(C.launchLine(a), 'AUGMENT_DISABLE_AUTO_UPDATE=1 npx -y @augmentcode/auggie@0.33.0 --acp');
  assert.equal(S.loginCmd(a), 'npx -y @augmentcode/auggie@0.33.0');
  const f = C.fromCatalog(catalog[2]);
  assert.deepEqual([f.launcher, f.spec, f.launcherNeeds], ['uvx', 'fast-agent-acp==0.9.22', 'uv']);
  assert.equal(S.loginCmd(f), 'uvx --from fast-agent-acp==0.9.22 fast-agent-acp');
  assert.equal(S.loginCmd(g), 'goose');
  const c = C.fromCustom({id: ' my-agent ', name: ' 我的 Agent ', command: 'my-agent --acp', env: 'TOKEN_FILE="~/a b"'});
  assert.deepEqual([c.id, c.name, c.added, c.launch], ['my-agent', '我的 Agent', 'custom', ['my-agent', '--acp']]);
  assert.equal(C.launchLine({launch: ['a', 'b c'], env: {}}), 'a "b c"');
});

test('添加不重复、移除只动添加的那张表', () => {
  const g = C.fromCatalog(catalog[0]);
  const l1 = C.addTo([], g);
  assert.equal(C.addTo(l1, C.fromCatalog(catalog[0])), l1);
  assert.deepEqual(C.removeFrom(C.addTo(l1, C.fromCatalog(catalog[1])), 'goose').map((h) => h.id), ['auggie']);
  assert.equal(C.removable(g), true);
  assert.equal(C.removable({id: 'claude', found: true}), false);
});

test('添加的那家：没检测到也留在主列表、不进选择器；检测到之后与内置一样进选择器', () => {
  const claude = {id: 'claude', name: 'Claude Code', found: true, enabled: true, loggedIn: true, models: [{id: 's', name: 'S'}]};
  const codex = {id: 'codex', name: 'Codex CLI', found: false, models: []};
  const gemini = {id: 'gemini', name: 'Gemini CLI', extra: true, found: false, models: []};
  const goose = C.fromCatalog(catalog[0]);
  const g = S.groups([claude, codex, gemini, goose]);
  assert.deepEqual(g.main.map((h) => h.id), ['claude', 'codex', 'goose']);
  assert.deepEqual(g.more.map((h) => h.id), ['gemini']);
  assert.deepEqual([g.total, g.found, g.added], [4, 1, 1]);
  assert.deepEqual(AG.providerRows([claude, codex, gemini, goose].map(mark), {}).map((r) => r.id), ['claude', 'codex']);
  /* 原型里检测落定：找到了、还要登录一次，模型表到手 → 进选择器（状态 attention，点了去设置） */
  const found = {...goose, ...C.detectedPatch()};
  assert.equal(S.health(found), 'login');
  assert.equal(found.models.length, C.DEMO_MODELS.length);
  assert.deepEqual(S.groups([claude, found]).main.map((h) => h.id), ['claude', 'goose']);
  const rows = AG.providerRows([claude, found].map(mark), {});
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [['claude', 'ready'], ['goose', 'attention']]);
  const ready = mark({...found, loggedIn: true});
  assert.equal(AG.providerRows([ready], {})[0].state, 'ready');
  const agents = AG.runnerOptions({harnesses: [mark(claude), ready, mark(goose)], models: []})[0].items.map((o) => o.harness);
  assert.equal(agents.includes('goose'), true);
  const missing = AG.runnerOptions({harnesses: [mark(claude), mark({...goose, id: 'other'})], models: []})[0].items.map((o) => o.harness);
  assert.equal(missing.includes('other'), false);
});

test('演示数据：内置九家（常驻五家 + 更多四家），目录不含内置的，id 合规且不重复', () => {
  ['model-substyle', 'model-pose', 'model-shape-paths', 'model-elements', 'model-textpresets', 'model-wordanim', 'model-subanim',
    'model-subpresets', 'model-motioncaption', 'model-template', 'model-cut', 'model-defaultsub', 'data'].forEach((m) => require('./' + m + '.js'));
  const A = window.BC_DATA.agent;
  const g = S.groups(A.harnesses);
  assert.deepEqual(g.main.filter((h) => !h.found).map((h) => h.id).concat(A.harnesses.filter((h) => h.found).map((h) => h.id)).sort(),
    ['claude', 'codex', 'copilot', 'opencode', 'pi']);
  assert.deepEqual(g.more.map((h) => h.id), ['gemini', 'cursor', 'grok', 'kimi']);
  assert.equal(A.harnesses.some((h) => h.id === 'deepseek' || h.id === 'fx'), false);
  const copilot = A.harnesses.find((h) => h.id === 'copilot');
  assert.deepEqual([copilot.cmd, copilot.launch, copilot.installs[0].cmd], ['copilot', ['copilot', '--acp'], 'npm install -g @github/copilot']);
  const opencode = A.harnesses.find((h) => h.id === 'opencode');
  assert.deepEqual([opencode.minVer, opencode.ver, opencode.latest], ['2.0.10', '2.0.24', '2.0.24']);
  assert.deepEqual(opencode.installs.map((m) => [m.cmd, m.upgrade, m.needs]),
    [['npm install -g @opencode/cli', 'npm install -g @opencode/cli@latest', 'Node.js']]);
  const pi = A.harnesses.find((h) => h.id === 'pi');
  assert.deepEqual([pi.minVer, pi.ver, pi.latest, pi.plan], ['0.84.4', '1.0.4', '1.0.4', 'Pi 里的模型账号']);
  const builtin = new Set(A.harnesses.map((h) => h.id));
  const ids = A.catalog.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of A.catalog) {
    assert.equal(builtin.has(e.id), false, e.id);
    assert.match(e.id, C.ID_RE, e.id);
    assert.ok(e.name && e.desc && e.command.length, e.id);
    if (e.command[0] === 'npx') assert.match(e.command.find((t) => !t.startsWith('-') && t !== 'npx'), /.@\d/, e.id + ' 的 npx 包要钉版本');
  }
});
