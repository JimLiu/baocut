const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-agent-setup.js');
require('./model-agent.js');
const S = window.BC_AGENT_SETUP;
const AG = window.BC_AGENT;

const claude = {id: 'claude', name: 'Claude Code', cmd: 'claude', found: true, enabled: true, ver: '2.1.4', minVer: '2.0.0', latest: '2.2.0',
  bin: '/opt/homebrew/bin/claude', loggedIn: true, runError: null, account: 'Claude Pro 订阅 · 已登录',
  installs: [{k: 'script', label: '官方脚本', cmd: 'curl x | bash', upgrade: 'claude update'}, {k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm i -g cc'}],
  models: [{id: 'sonnet', name: 'Sonnet', dflt: true, tier: 'balanced'}, {id: 'opus', name: 'Opus', tier: 'max'}, {id: 'haiku', name: 'Haiku', tier: 'fast'}]};
const mark = (h) => ({...h, blocked: S.blocked(h)});

test('版本按数字段比较，不按字符串', () => {
  assert.equal(S.compareVer('2.10.0', '2.9.9'), 1);
  assert.equal(S.compareVer('1.0.88', '2.0.0'), -1);
  assert.equal(S.compareVer('2.1', '2.1.0'), 0);
});

test('状态优先级：未安装 > 无法运行 > 版本过旧 > 需要登录 > 已停用 > 可用', () => {
  assert.equal(S.health({...claude, found: false, runError: 'x'}), 'missing');
  assert.equal(S.health({...claude, runError: 'x', ver: '1.0.0', loggedIn: false}), 'error');
  assert.equal(S.health({...claude, ver: '1.0.0', loggedIn: false}), 'outdated');
  assert.equal(S.health({...claude, loggedIn: false, enabled: false}), 'login');
  assert.equal(S.health({...claude, enabled: false}), 'off');
  assert.equal(S.health(claude), 'ready');
});

test('有新版本不是问题：仍然可用，只换状态词；没装的不算 blocked', () => {
  assert.equal(S.hasUpdate(claude), true);
  assert.deepEqual(S.badge(claude), {tone: 'notice', label: '可用 · 有新版本'});
  assert.equal(S.problem(claude), null);
  assert.equal(S.blocked(claude), false);
  assert.equal(S.blocked({...claude, found: false}), false);
  assert.equal(S.blocked({...claude, loggedIn: false}), true);
});

test('问题条给对症的动作：登录 / 升级 / 排查', () => {
  assert.equal(S.problem({...claude, loggedIn: false}).action, 'login');
  assert.equal(S.problem({...claude, ver: '1.0.0'}).action, 'upgrade');
  assert.equal(S.problem({...claude, runError: '启动失败。'}).action, 'diagnose');
});

test('排查清单：第一条失败之后的步骤标 skip，不重复报错', () => {
  const steps = S.diagnose({...claude, ver: '1.0.0', loggedIn: false});
  assert.deepEqual(steps.map((s) => s.state), ['ok', 'ok', 'fail', 'skip', 'skip']);
  assert.equal(steps[2].fix.action, 'upgrade');
  assert.equal(S.verdict(steps).ok, false);
  assert.equal(S.verdict(S.diagnose(claude)).ok, true);
  assert.deepEqual(S.diagnose({...claude, found: false}).map((s) => s.state), ['fail', 'skip', 'skip', 'skip', 'skip']);
});

test('默认模型：没设过用推荐档，auto 交给 CLI，目录里没有的回落推荐', () => {
  assert.equal(S.defaultModel(claude, {}), 'sonnet');
  assert.equal(S.defaultModel(claude, {claude: 'opus'}), 'opus');
  assert.equal(S.defaultModel(claude, {claude: 'auto'}), null);
  assert.equal(S.defaultModel(claude, {claude: 'gone-model'}), 'sonnet');
  const rows = S.modelChoices(claude, {claude: 'gone-model'});
  assert.equal(rows[0].gone, true);
  assert.equal(rows.find((r) => r.on).id, 'sonnet');
  assert.equal(rows[rows.length - 1].id, 'auto');
  assert.equal(S.modelLabel(claude, {}), 'Sonnet · 推荐');
});

test('安装与升级用同一张方法表；升级没有专用命令时退回安装命令', () => {
  assert.equal(S.installPlan(claude, 'script', true).cmd, 'claude update');
  assert.equal(S.installPlan(claude, 'npm', true).cmd, 'npm i -g cc');
  assert.equal(S.installPlan(claude, 'nope', false).k, 'script');
  assert.equal(S.installPlan({installs: []}, 'x'), null);
});

test('已装那一份归谁管看真实位置，次序与内核 install_source 相同', () => {
  const src = (bin, real) => S.installSource(bin, real);
  // 本机实测（2026-09-23）：bun 装的 codex、Homebrew formula 的 gemini（真身里也有 node_modules）、官方脚本的 claude。
  assert.deepEqual(src('/Users/jim/.bun/bin/codex', '/Users/jim/.bun/install/global/node_modules/@openai/codex/bin/codex.js'),
    {k: 'bun', pkg: '@openai/codex', prefix: null, cask: false});
  assert.deepEqual(src('/opt/homebrew/bin/gemini', '/opt/homebrew/Cellar/gemini-cli/0.46.0/libexec/lib/node_modules/@google/gemini-cli/bundle/gemini.js'),
    {k: 'brew', pkg: 'gemini-cli', prefix: null, cask: false});
  assert.equal(src('/Users/jim/.local/bin/claude', '/Users/jim/.local/share/claude/versions/2.1.280').k, 'script');
  assert.deepEqual(src('/opt/homebrew/bin/codex', '/opt/homebrew/Caskroom/codex/0.155.1/codex-aarch64-apple-darwin'),
    {k: 'brew', pkg: 'codex', prefix: null, cask: true});
  // Homebrew 的 node 下 npm -g 装的：链接同在 /opt/homebrew/bin，却不是 Homebrew 的包。
  assert.deepEqual(src('/opt/homebrew/bin/codex', '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'),
    {k: 'npm', pkg: '@openai/codex', prefix: '/opt/homebrew', cask: false});
  assert.equal(src('/Users/me/.nvm/versions/node/v22.3.0/bin/codex', '/Users/me/.nvm/versions/node/v22.3.0/lib/node_modules/@openai/codex/bin/codex.js').prefix,
    '/Users/me/.nvm/versions/node/v22.3.0');
  assert.deepEqual(src('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'), {k: 'npm', pkg: null, prefix: 'C:\\Users\\me\\AppData\\Roaming\\npm', cask: false});
  assert.equal(src('/Users/me/.volta/bin/codex', '/opt/homebrew/Cellar/volta/2.0.2/bin/volta-shim').k, 'volta');
  assert.equal(src('/Users/me/Library/pnpm/gemini', '/Users/me/Library/pnpm/global/5/.pnpm/@google+gemini-cli@0.46.0/node_modules/@google/gemini-cli/bundle/gemini.js').pkg, '@google/gemini-cli');
  assert.equal(src('/Users/me/.yarn/bin/pi', '/Users/me/.config/yarn/global/node_modules/@earendil-works/pi-coding-agent/dist/cli.js').k, 'yarn');
  // 某个目录里的本地安装不是 npm 全局；mise / asdf 的 shim 与认不出的一律 null。
  assert.equal(src('/Users/me/.claude/local/claude', '/Users/me/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js').k, 'script');
  assert.equal(src('/Users/me/.local/share/mise/shims/codex', '/opt/homebrew/Cellar/mise/2026.9.1/bin/mise'), null);
  assert.equal(src('/usr/local/bin/claude'), null);
});

test('升级命令按已装那一份推，npm 钉住前缀；新装只列方式表', () => {
  const codex = {id: 'codex', cmd: 'codex', found: true, installs: [
    {k: 'brew', label: 'Homebrew', needs: 'Homebrew', cmd: 'brew install codex', upgrade: 'brew upgrade codex'},
    {k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @openai/codex', upgrade: 'npm install -g @openai/codex@latest'}]};
  const bun = {...codex, bin: '~/.bun/bin/codex', realBin: '~/.bun/install/global/node_modules/@openai/codex/bin/codex.js'};
  assert.deepEqual(S.installMethods(bun, true).map((m) => m.k), ['brew', 'npm', 'bun']);
  assert.equal(S.startMethod(bun, true), 'bun');
  assert.equal(S.installPlan(bun, S.startMethod(bun, true), true).cmd, 'bun add -g @openai/codex@latest');
  assert.equal(S.installPlan(bun, 'bun', true).needs, 'Bun');
  // 新装不看检测结果；没装的（演示数据里「装好之后」的路径在 ~/.bun 下）也不出 bun。
  assert.deepEqual(S.installMethods(bun, false).map((m) => m.k), ['brew', 'npm']);
  assert.deepEqual(S.installMethods({...bun, found: false}, true).map((m) => m.k), ['brew', 'npm']);
  // 用户点过的压过检测到的；点的不在表里就退回检测到的。
  assert.equal(S.installPlan(bun, 'npm', true).k, 'npm');
  assert.equal(S.installPlan(bun, 'script', true).k, 'bun');
  // 表里有的方式换成推出来的那一条，不重复列。
  const npm = {...codex, bin: '/opt/homebrew/bin/codex', realBin: '/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js'};
  assert.deepEqual(S.installMethods(npm, true).map((m) => m.cmd), ['brew upgrade codex', 'npm install -g --prefix /opt/homebrew @openai/codex@latest']);
  assert.equal(S.detected(npm), 'npm');
  // fnm 的前缀带空格要加引号；钉了版本的沿用钉住的版本。
  const fnm = S.installSource('/x/fnm_multishells/1/bin/codex', '/Users/me/Library/Application Support/fnm/node-versions/v24.1.0/installation/lib/node_modules/@openai/codex/bin/codex.js');
  assert.equal(S.upgradeCmd(codex, fnm).cmd, 'npm install -g --prefix "/Users/me/Library/Application Support/fnm/node-versions/v24.1.0/installation" @openai/codex@latest');
  const dsh = {installs: [{k: 'npm', cmd: 'npm install -g @deepseek-ai/dsh@0.1.1-rc.2', upgrade: 'npm install -g @deepseek-ai/dsh@0.1.1-rc.2'}]};
  assert.equal(S.upgradeCmd(dsh, S.installSource('/opt/homebrew/bin/dsh', '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/dist/cli.js')).cmd,
    'npm install -g --prefix /opt/homebrew @deepseek-ai/dsh@0.1.1-rc.2');
  // 官方脚本目录里的 codex（它没有脚本方式）：认得来源也推不出命令，退回第一条。
  const loose = {...codex, bin: '/Users/me/.local/bin/codex'};
  assert.equal(S.detected(loose), null);
  assert.equal(S.startMethod(loose, true), 'brew');
  const run = S.demoRun(S.installPlan(bun, 'bun', true), {...bun, name: 'Codex CLI', ver: '0.1.0', latest: '0.2.0'}, true, false);
  assert.match(run.lines.join('\n'), /installed @openai\/codex@0\.2\.0/);
});

test('演示数据：新装只有官方脚本 / Homebrew / npm 三种，每一家的演示路径都认得出', () => {
  // data.js 依赖一长串模型模块，这里直接读源码里的安装行。
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'data.js'), 'utf8');
  const kinds = [...src.matchAll(/\{k: '(\w+)', label: '[^']*'(?:, needs: '[^']*')?, cmd: '/g)].map((m) => m[1]);
  assert.ok(kinds.length > 10);
  assert.deepEqual([...new Set(kinds)].sort(), ['brew', 'npm', 'script']);
});

test('页顶状态卡：可用 > 有问题 > 已停用 > 一个都没装', () => {
  const codex = {id: 'codex', name: 'Codex CLI', found: false};
  assert.equal(S.overview([claude, codex]).state, 'ready');
  assert.equal(S.overview([{...claude, loggedIn: false}, codex]).state, 'attention');
  assert.equal(S.overview([{...claude, enabled: false}, codex]).action, 'enable');
  assert.equal(S.overview([{...claude, found: false}, codex]).state, 'missing');
});

test('装着却用不了的不参与挑选；可用性分出 attention，不再说成「都停用了」', () => {
  const bad = mark({...claude, loggedIn: false});
  assert.equal(AG.pickHarness([bad]), null);
  const avail = AG.agentAvailability([bad]);
  assert.equal(avail.state, 'attention');
  assert.equal(AG.setupGuide(avail).state, 'attention');
  assert.equal(AG.providerRows([bad], {})[0].state, 'attention');
  assert.equal(AG.agentAvailability([mark({...claude, enabled: false})]).state, 'off');
  assert.equal(AG.pickHarness([mark(claude)]).id, 'claude');
});

test('每个演示场景都落在预期状态上', () => {
  const want = {default: 'ready', fresh: 'missing', login: 'login', outdated: 'outdated', error: 'error', both: 'ready', many: 'ready', modelGate: 'ready', opencode1: 'ready'};
  for (const sc of S.SCENARIOS) assert.equal(S.health({...claude, ...(S.scenarioPatch(sc.k).claude || {})}), want[sc.k], sc.k);
});

test('完整 provider 表：检测到的在前 + 常驻的直接列，「更多」里没检测到的折叠；选择器与工具页不列没检测到的「更多」', () => {
  const codex = {id: 'codex', name: 'Codex CLI', found: false};
  const cursor = {id: 'cursor', name: 'Cursor CLI', extra: true, found: false, models: []};
  const pi = {id: 'pi', name: 'Pi', extra: true, found: true, enabled: true, loggedIn: true, models: []};
  const g = S.groups([codex, claude, cursor, pi]);
  assert.deepEqual(g.main.map((h) => h.id), ['claude', 'pi', 'codex']);
  assert.deepEqual(g.more.map((h) => h.id), ['cursor']);
  assert.deepEqual([g.total, g.found], [4, 2]);
  assert.equal(S.moreSummary([cursor]), 'Cursor CLI');
  assert.equal(S.moreSummary([cursor, pi, codex, claude]), 'Cursor CLI、Pi、Codex CLI 等');
  assert.deepEqual(AG.providerRows([claude, codex, cursor, pi].map(mark), {}).map((r) => r.id), ['claude', 'codex', 'pi']);
  const agents = AG.runnerOptions({harnesses: [claude, cursor, pi].map(mark), models: []})[0].items.map((o) => o.harness);
  assert.equal(agents.includes('cursor'), false);
  assert.equal(agents.includes('pi'), true);
});

test('只有不从网络下载脚本的命令才给 ▶ 直接运行', () => {
  assert.equal(S.runnable({cmd: 'brew install codex'}), true);
  assert.equal(S.runnable({cmd: 'claude update'}), true);
  assert.equal(S.runnable({cmd: 'curl -fsSL https://claude.ai/install.sh | bash'}), false);
  assert.equal(S.runnable(null), false);
});

test('运行输出只留最后 LOG_MAX 行', () => {
  const many = Array.from({length: S.LOG_MAX + 5}, (_, i) => 'l' + i);
  const log = S.appendLog(['a'], many);
  assert.equal(log.length, S.LOG_MAX);
  assert.equal(log[log.length - 1], 'l' + (S.LOG_MAX + 4));
  assert.deepEqual(S.appendLog(null, ['x']), ['x']);
});

test('演示输出：包名去版本后缀，失败带非零退出码', () => {
  assert.equal(S.pkgOf('npm install -g @google/gemini-cli@latest'), '@google/gemini-cli');
  assert.equal(S.pkgOf('brew upgrade gemini-cli'), 'gemini-cli');
  const brew = {k: 'brew', cmd: 'brew upgrade gemini-cli'};
  assert.equal(S.demoRun(brew, claude, true, false).code, 0);
  assert.match(S.demoRun(brew, claude, true, false).lines.at(-1), /gemini-cli\/2\.2\.0/);
  const npm = S.demoRun({k: 'npm', cmd: 'npm i -g cc'}, claude, false, true);
  assert.notEqual(npm.code, 0);
  assert.ok(npm.lines.some((l) => /EACCES/.test(l)));
});

test('没有安装命令的 provider：installPlan 为空，视图改走「按官方说明安装」', () => {
  assert.equal(S.installPlan({id: 'fx', installs: []}, undefined, false), null);
});

test('会话里的失败详情：只有指向账号的那几句才算「要重新登录」', () => {
  // 本机真实复现过的那一句（设计稿 R1，2026-09-04）。
  assert.equal(S.authFailure('Failed to authenticate: OAuth session expired and could not be refreshed'), true);
  assert.equal(S.authFailure('Error: Not logged in. Please run /login'), true);
  assert.equal(S.authFailure('stream error: 401 Unauthorized'), true);
  assert.equal(S.authFailure('No API key found; run `codex login`'), true);
  // 过程里的常态失败不是账号问题，别把人支到登录上去。
  assert.equal(S.authFailure('agent exited with code 1'), false);
  assert.equal(S.authFailure("EACCES: permission denied, open '/etc/hosts'"), false);
  assert.equal(S.authFailure('Tool call forbidden by sandbox policy'), false);
  assert.equal(S.authFailure('The author of this file is unknown; read it first'), false);
  assert.equal(S.authFailure(''), false);
});

test('登录命令：有专门子命令的用子命令，其余直接起 CLI', () => {
  assert.equal(S.loginCmd({cmd: 'claude'}), 'claude');
  assert.equal(S.loginCmd({cmd: 'codex'}), 'codex login');
  assert.equal(S.loginCmd({cmd: 'opencode'}), 'opencode auth login');
  assert.equal(S.loginCmd({cmd: 'cursor-agent'}), 'cursor-agent login');
  assert.equal(S.loginCmd(null), '');
});

/* ---------- 默认模型需要更新的 CLI（2026-09-29） ---------- */
const codex = {id: 'codex', name: 'Codex CLI', cmd: 'codex', found: true, enabled: true, ver: '0.153.0', minVer: '0.120.0', latest: '0.158.0',
  loggedIn: true, runError: null, account: 'ChatGPT Plus / Pro 订阅',
  configModel: 'gpt-6-sol', configModelKnown: false,
  models: [{id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', dflt: true}, {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'fast'}]};

test('defaultModelGate：只在「找到了 + 配置里有模型 + 这一版明确不认得」时拦', () => {
  const g = S.defaultModelGate(codex);
  assert.deepEqual({...g, fallback: g.fallback.id}, {model: 'gpt-6-sol', ver: '0.153.0', latest: '0.158.0', fallback: 'gpt-5.6-sol'});
  // 隐藏模型：可见表里没有，但内核在完整表（含隐藏）里认得它 → 不拦，视图也不拿可见表重算
  assert.equal(S.defaultModelGate({...codex, configModelKnown: true}), null);
  // 判断不了（null）不拦；没读到配置、没装也不拦
  assert.equal(S.defaultModelGate({...codex, configModelKnown: null}), null);
  assert.equal(S.defaultModelGate({...codex, configModel: null}), null);
  assert.equal(S.defaultModelGate({...codex, found: false}), null);
  // 没有更新的版本：latest 给 null，文案不许说「最新 X」
  assert.equal(S.defaultModelGate({...codex, latest: '0.153.0'}).latest, null);
  // 推荐模型恰好就是配置里那个：改选建议换成表里别的
  assert.equal(S.defaultModelGate({...codex, configModel: 'gpt-5.6-sol'}).fallback.id, 'gpt-5.6-luna');
});

test('defaultModelGate 不改状态：CLI 照样可用、不 blocked、没有问题条；状态词换成「默认模型需升级」', () => {
  assert.equal(S.health(codex), 'ready');
  assert.equal(S.blocked(codex), false);
  assert.equal(S.problem(codex), null);
  assert.deepEqual(S.badge(codex), {tone: 'notice', label: '可用 · 默认模型需升级'});
  assert.deepEqual(S.badge({...codex, latest: '0.153.0'}), {tone: 'notice', label: '可用 · 默认模型不可用'});
  assert.deepEqual(S.badge({...codex, configModelKnown: true}), {tone: 'notice', label: '可用 · 有新版本'});
  assert.equal(S.badge({...codex, enabled: false}).label, '已停用');
  assert.equal(AG.providerRows([mark(codex)], {})[0].state, 'ready');
});

test('modelGateFailure：认 CLI 的两种英文原话，取引号里的模型 id；与登录失败互不相吞', () => {
  const a = "The 'gpt-6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
  const b = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";
  assert.deepEqual(S.modelGateFailure(a), {model: 'gpt-6-sol'});
  assert.deepEqual(S.modelGateFailure(b), {model: 'gpt-6-sol'});
  assert.deepEqual(S.modelGateFailure('THE MODEL REQUIRES A NEWER VERSION OF CODEX'), {model: null});
  assert.equal(S.authFailure(a), false);
  assert.equal(S.authFailure(b), false);
  assert.equal(S.modelGateFailure('Failed to authenticate: OAuth session expired and could not be refreshed'), null);
  assert.equal(S.modelGateFailure('stream disconnected before completion'), null);
  assert.equal(S.modelGateFailure(null), null);
});

test('modelRows：拦住时「Agent 默认模型」行的副文案直说要升级 CLI，行照样能选', () => {
  const rows = AG.modelRows(codex, {harness: 'codex', model: null}, S.defaultModelGate(codex));
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].on, true);
  assert.equal(rows[0].sub, '按 CLI 配置选择 · gpt-6-sol 需要升级 CLI');
  assert.equal(AG.modelRows(codex, {harness: 'codex', model: null})[0].sub, '按 CLI 配置选择');
});

test('推荐模型按系列取：Claude 第一个 Sonnet、Codex 第一个 -sol（按 CLI 自己的次序）；其余几家不变', () => {
  const newer = {...codex, ver: '0.159.0', configModelKnown: true,
    models: [{id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', dflt: true}, {id: 'gpt-6-sol', name: 'GPT-6 Sol'}, {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol'}, {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'fast'}]};
  assert.equal(S.defaultModel(newer, {}), 'gpt-6.1-sol');
  assert.equal(S.defaultModel(codex, {}), 'gpt-5.6-sol');
  assert.equal(S.defaultModel({...claude, models: [{id: 'opus', name: 'Opus', tier: 'max'}, {id: 'sonnet', name: 'Sonnet'}]}, {}), 'sonnet');
  // 没设过 = 推荐；只有明确选了「交给 Agent 自己决定」才是 null（不传模型）
  assert.equal(S.defaultModel(newer, {codex: 'auto'}), null);
  // 「推荐」只挂在推荐的那一个上
  assert.deepEqual(S.modelChoices(newer, {}).filter((c) => c.tag === '推荐').map((c) => c.id), ['gpt-6.1-sol']);
  assert.equal(S.modelLabel(newer, {}), 'GPT-6.1 Sol · 推荐');
  const pi = {id: 'pi', models: [{id: 'x', name: 'X'}, {id: 'y', name: 'Y', tier: 'balanced'}]};
  assert.equal(S.recommended(pi).id, 'y');
});

test('OpenCode 1.x 只能改装 @opencode/cli：问题说明说改装，升级段不沿用旧来源', () => {
  const oc = {id: 'opencode', name: 'OpenCode', cmd: 'opencode', found: true, enabled: true, loggedIn: true, runError: null,
    ver: '1.4.0', minVer: '2.0.10', latest: '2.0.24', reinstall: {below: '2.0.0', from: '官方脚本或 opencode-ai 包', pkg: '@opencode/cli'},
    installs: [{k: 'npm', label: 'npm', needs: 'Node.js', cmd: 'npm install -g @opencode/cli', upgrade: 'npm install -g @opencode/cli@latest'}]};
  for (const where of [{bin: '~/.opencode/bin/opencode'},
    {bin: '/opt/homebrew/bin/opencode', realBin: '/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode'}]) {
    const h = {...oc, ...where};
    assert.equal(S.health(h), 'outdated');
    assert.equal(S.needsReinstall(h), true);
    const p = S.problem(h);
    assert.equal(p.cta, '改装 @opencode/cli');
    assert.match(p.body, /1\.4\.0.*改装 @opencode\/cli/);
    assert.deepEqual(S.installMethods(h, true).map((m) => m.cmd), ['npm install -g @opencode/cli@latest']);
    assert.equal(S.installPlan(h, null, true).cmd, 'npm install -g @opencode/cli@latest');
  }
  /* 2.x 但低于最低版本：普通升级，沿用检测到的 npm 前缀。 */
  const v2 = {...oc, ver: '2.0.3', bin: '/opt/homebrew/bin/opencode', realBin: '/opt/homebrew/lib/node_modules/@opencode/cli/bin/opencode.js'};
  assert.equal(S.needsReinstall(v2), false);
  assert.equal(S.problem(v2).cta, '升级到 2.0.24');
  assert.equal(S.installPlan(v2, null, true).cmd, 'npm install -g --prefix /opt/homebrew @opencode/cli@latest');
  assert.equal(S.problem(S.scenarioPatch('opencode1').opencode && {...oc, ...S.scenarioPatch('opencode1').opencode}).action, 'upgrade');
});
