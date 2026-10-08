const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
global.window = {};
require('./model-surface.js');
const S = global.window.BC_SURFACE;

const RAIL = ['transcript', 'subtitle', 'aitools', 'elements', 'text', 'image', 'video', 'audio', 'brand', 'settings']
  .map((k) => ({k}));

test('不写 BC_SURFACE_ID 就是 app：全功能', () => {
  assert.equal(S.id, 'app');
  assert.equal(S.ai, true);
  assert.equal(S.agent, true);
  assert.equal(S.sidebarDefaultOpen, true);
  assert.equal(S.appRail, true);
  assert.deepEqual(S.rail(RAIL), RAIL);
  assert.equal(S.storageKey('bc-nav-v1'), 'bc-nav-v1');
  assert.deepEqual(S.normalizeRoute({r: 'tasks'}, () => true), {r: 'tasks'});
});

test('web：没有 AI / Agent / 页面 / 帮助，侧栏默认收起', () => {
  const W = S.make('web');
  assert.equal(W.isWeb, true);
  ['ai', 'agent', 'pages', 'help', 'windowChrome', 'sidebarDefaultOpen', 'appRail'].forEach((k) => assert.equal(W[k], false, k));
});

test('web 的 rail 只少「AI 工具」一项，顺序不动', () => {
  const W = S.make('web');
  assert.deepEqual(W.rail(RAIL).map((r) => r.k),
    ['transcript', 'subtitle', 'elements', 'text', 'image', 'video', 'audio', 'brand', 'settings']);
});

test('web 落点 Tab：aitools 退回文稿，其余原样', () => {
  const W = S.make('web');
  assert.equal(W.landingTab('aitools'), 'transcript');
  assert.equal(W.landingTab('elements'), 'elements');
  assert.equal(S.landingTab('aitools'), 'aitools');
});

test('web 的存储键与 app 分开', () => {
  const W = S.make('web');
  assert.equal(W.storageKey('bc-nav-v1'), 'bc-web-nav-v1');
  assert.equal(W.storageKey('bc-prefs-v1'), 'bc-web-prefs-v1');
});

test('web 路由只有编辑器与「还没选项目」', () => {
  const W = S.make('web');
  const has = (id) => id === 'p1';
  assert.deepEqual(W.normalizeRoute({r: 'editor', id: 'p1', t: 12}, has), {r: 'editor', id: 'p1', t: 12});
  assert.deepEqual(W.normalizeRoute({r: 'editor', id: 'gone'}, has), {r: 'none'});
  ['home', 'projects', 'tasks', 'tools', 'services', 'settings', 'agent'].forEach((r) =>
    assert.deepEqual(W.normalizeRoute({r}, has), {r: 'none'}, r));
});

test('未知 id 按 app 处理', () => {
  assert.equal(S.make('desktop').id, 'app');
});

/* ---------- 两个入口 HTML 不许各漂各的 ----------
   BaoCutWeb.html 与 BaoCut.html 共享同一批模块：Web 引用的每个脚本 / 样式都必须出现在 App 入口里，
   且缓存串一致（否则同一个文件两边拿到的版本不一样）；Web 独有的只有外壳那几份；
   AI / Agent / 页面模块一份都不许进 Web 入口。 */
const refs = (file) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'build/entries', file === 'BaoCut.html' ? 'app.html' : 'web.html'), 'utf8');
  const out = new Map();
  const re = /(?:src|href)="(app\/[^"?]+)(?:\?v=([^"]+))?"/g;
  let m;
  while ((m = re.exec(html))) out.set(m[1], m[2] || '');
  return out;
};
const WEB_ONLY = ['app/web-shell.jsx', 'app/web-shell.css', 'app/web-main.jsx'];
const WEB_DENY = [
  /^app\/panel-aitools/, /^app\/panel-dub/, /^app\/panel-crop/, /^app\/stage-crop/, /^app\/store-crop/, /^app\/crop\.css/,
  /^app\/store-shorts-cut/, /^app\/stage-shorts-cut/, /^app\/shorts-cut\.css/,
  /^app\/panel-tts/, /^app\/glossary-tool/, /^app\/agent-/, /^app\/page-/, /^app\/settings-/, /^app\/tool-/, /^app\/tools\.css/,
  /^app\/services\.css/, /^app\/new-/, /^app\/newproject-flow/, /^app\/import-flow/, /^app\/import-panel/, /^app\/help-center/,
  /^app\/main\.jsx/, /^app\/voice-picker/, /^app\/model-openai-api/, /^app\/panel-image-gen/, /^app\/image-gen/, /^app\/model-writing/,
  /^app\/model-settings-nav/, /^app\/model-settings-link/, /^app\/model-app-update/, /^app\/model-models-dir/, /^app\/model-local-check/,
  /* App rail / Home / Space（2026-10-01）：只属于 App 外壳，且全部用 react-spectrum */
  /^app\/apprail/, /^app\/home-/, /^app\/space/, /^app\/model-home/, /^app\/model-space/, /^app\/model-app-ia/,
  /^app\/model-agent-projects/, /^app\/model-llm-tools/,
  /* 视频工具的目标与运行（2026-10-03）：只在 App 的工具页；/^app\/model-tool-/ 不含 Web 也加载的 model-tools.js */
  /^app\/model-tool-/,
  /* 输入框「+」菜单（使用 Skill / 最近的视频 / 本地文件）：只在 Home 与会话的 Agent 输入框 */
  /^app\/composer-/,
  /* 会话里视频卡的活、下载卡、候选卡与下载 / 转录 / 翻译 / 导出的演示脚本：只在 App 的会话线程（agent-cards.jsx 已在 /^app\/agent-/ 里） */
  /^app\/model-agent-cards/, /^app\/model-agent-sim/, /^app\/store-agent-sim/,
  /* 会话线程的像素加载图形（步骤类别 → 图形名）：只在 App 的会话线程与会话输入框 */
  /^app\/model-agent-loader/,
  /* API 提供方与用量（product-design §7.6）：用量账本的读法与 API 提供方图标只在 App 的设置里；API 提供方目录 model-vendors.js 随 store 进 Web */
  /^app\/model-usage/, /^app\/vendor-icon/,
  /* 设置 › Agent「添加更多 Agent」的目录与自定义命令（product-design §7.6）：只在 App 的设置页 */
  /^app\/model-agent-catalog/,
  /* 任务详情里工具运行的产物与操作（2026-10-06）：只在 App 的任务页 */
  /^app\/model-task-outputs/,
  /* Home 文件标签页；Web 原型没有 Home 或会话。 */
  /^app\/model-file-preview/, /^app\/file-tab-preview/, /^app\/model-media-preview/, /^app\/model-media-gif/, /^app\/media-preview/,
];

test('Web 入口：共享模块与 App 同名同缓存串', () => {
  const app = refs('BaoCut.html');
  const web = refs('BaoCutWeb.html');
  assert.ok(web.size > 50, 'Web 入口应当加载共享模块');
  web.forEach((v, file) => {
    if (WEB_ONLY.indexOf(file) >= 0) return;
    assert.ok(app.has(file), `${file} 只在 Web 入口里——共享模块必须两边都有`);
    assert.equal(v, app.get(file), `${file} 的缓存串两边不一致`);
  });
  WEB_ONLY.forEach((f) => assert.ok(web.has(f), `Web 入口缺 ${f}`));
  assert.ok(app.has('app/model-surface.js') && web.has('app/model-surface.js'));
});

test('Web 入口：AI / Agent / 页面模块一份都不加载', () => {
  const web = refs('BaoCutWeb.html');
  web.forEach((_, file) => {
    WEB_DENY.forEach((re) => assert.ok(!re.test(file), `${file} 不该出现在 Web 入口`));
  });
});

test('Web 入口不打包 Agent 专属的 npm 模块（markdown-it 只进 App）', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'build/entries', f), 'utf8');
  assert.doesNotMatch(read('web.html'), /data-npm=/);
  assert.match(read('app.html'), /<script data-npm="markdown-it"><\/script>/);
});

test('Web 入口在加载模块之前声明表面', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'build/entries/web.html'), 'utf8');
  const decl = html.indexOf("window.BC_SURFACE_ID = 'web'");
  assert.ok(decl > 0 && decl < html.indexOf('src="app/model-surface.js'));
});

/* Both surfaces share S2; only product capabilities differ. */
test('App、Web 与样本页加载同一份 S2，并且先加载适配层再加载控件', () => {
  const entries = ['app.html', 'web.html', 'components.html'].map(file =>
    fs.readFileSync(path.join(__dirname, '..', 'build/entries', file), 'utf8'));
  const bundle = /src="(vendor\/react-spectrum-s2\/react-spectrum-s2\.js[^" ]*)"/;
  entries.forEach(html => {
    assert.ok(bundle.test(html));
    assert.ok(html.indexOf('src="vendor/react-spectrum-s2') < html.indexOf('src="app/ui-spectrum.jsx'));
    assert.ok(html.indexOf('src="app/ui-spectrum.jsx') < html.indexOf('src="app/ui.jsx'));
    assert.equal(html.match(bundle)[1], entries[0].match(bundle)[1]);
  });
});
