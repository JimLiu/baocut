const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-tool-cookies.js');
const C = global.window.BC_TOOL_COOKIES;
const several = C.DEMO_DETECTED.darwin.several;

test('勾选的浏览器按检测到的顺序排（就是尝试的顺序），没检测到的去掉', () => {
  assert.deepEqual(several.map((b) => b.id), ['chrome', 'safari', 'firefox', 'edge']);
  assert.deepEqual(C.ordered(['edge', 'chrome'], several), ['chrome', 'edge']);
  assert.deepEqual(C.ordered(['brave', 'safari'], several), ['safari']);
  assert.deepEqual(C.ordered(['chrome'], C.DEMO_DETECTED.darwin.none), ['chrome']);
  assert.deepEqual(C.toggle(['edge'], 'chrome', true, several), ['chrome', 'edge']);
  assert.deepEqual(C.toggle(['chrome', 'edge'], 'chrome', false, several), ['edge']);
});

test('「所有浏览器」：全选、半选与没选；点它在全选时清空，否则选上全部', () => {
  assert.deepEqual(C.allState([], several), {selected: false, indeterminate: false});
  assert.deepEqual(C.allState(['safari'], several), {selected: false, indeterminate: true});
  assert.deepEqual(C.allState(['edge', 'firefox', 'safari', 'chrome'], several), {selected: true, indeterminate: false});
  assert.deepEqual(C.allState([], C.DEMO_DETECTED.darwin.none), {selected: false, indeterminate: false});
  assert.deepEqual(C.toggleAll([], several), ['chrome', 'safari', 'firefox', 'edge']);
  assert.deepEqual(C.toggleAll(['safari'], several), ['chrome', 'safari', 'firefox', 'edge']);
  assert.deepEqual(C.toggleAll(['chrome', 'safari', 'firefox', 'edge'], several), []);
});

test('说明：按勾了几个说怎么用；总说只读勾选的、不保存 Cookie；macOS 的钥匙串与 Safari 权限按勾选提示', () => {
  const none = C.notes([], 'darwin');
  assert.match(none[0], /匿名下载/);
  assert.match(none[1], /只读取你勾选的浏览器.*不保存 Cookie 内容/);
  assert.equal(none.length, 2);
  assert.match(C.notes(['firefox'], 'darwin')[0], /用 Firefox 的 Cookie/);
  assert.equal(C.notes(['firefox'], 'darwin').length, 2);
  const many = C.notes(['chrome', 'safari', 'edge'], 'darwin');
  assert.match(many[0], /按 Chrome → Safari → Edge 的顺序逐个试/);
  assert.match(many[2], /为 Chrome、Edge 各弹出一次钥匙串授权/);
  assert.match(many[3], /完全磁盘访问权限/);
  assert.match(C.notes(['edge'], 'darwin')[2], /^macOS 会为 Edge 弹出一次钥匙串授权/);
  assert.equal(C.notes(['chrome', 'safari'], 'linux').length, 2);
});

test('Windows：Chromium 内核的开着时读不到、要先退出；Chrome、Edge、Brave 的应用绑定加密可能读不到；没勾 Firefox 时建议改用它', () => {
  const chrome = C.notes(['chrome'], 'win32');
  assert.equal(chrome.length, 4);
  assert.match(chrome[2], /^Chrome 开着时 Cookie 库被占用.*先完全退出这个浏览器/);
  assert.match(chrome[3], /^Chrome 在 Windows 上通常用应用绑定加密.*可能读不到.*建议在 Firefox 里登录目标网站后改勾 Firefox。$/);
  assert.doesNotMatch(chrome.join(''), /钥匙串|完全磁盘访问权限/);
  /* Opera、Vivaldi 只有占用的问题，不说应用绑定加密 */
  const opera = C.notes(['opera', 'vivaldi'], 'win32');
  assert.equal(opera.length, 3);
  assert.match(opera[2], /^Opera、Vivaldi 开着时.*这些浏览器.*改勾 Firefox。$/);
  /* 勾了 Firefox 就不再建议 */
  const mixed = C.notes(['chrome', 'firefox', 'edge', 'brave'], 'win32');
  assert.match(mixed[3], /^Chrome、Edge、Brave 在 Windows 上通常用应用绑定加密/);
  assert.doesNotMatch(mixed.join(''), /改勾 Firefox/);
  assert.equal(C.notes(['firefox'], 'win32').length, 2);
  assert.equal(C.notes([], 'win32').length, 2);
});

test('任务行与结果：匿名、用哪个浏览器、依次试哪几个', () => {
  assert.equal(C.subText([]), '匿名下载');
  assert.equal(C.subText(['safari']), '使用 Safari 的 Cookie');
  assert.equal(C.subText(['chrome', 'firefox']), '依次试 Chrome、Firefox 的 Cookie');
  assert.equal(C.usedText('chrome'), '用了 Chrome 的 Cookie');
});

test('都没成功：一个时就是那个的错误，多个时一起说明每个浏览器的结果（与 Runtime 同一个说法）', () => {
  assert.match(C.failureText([{browser: 'chrome', login: true}]), /^网站要求登录或验证/);
  assert.match(C.failureText([{browser: 'chrome', login: false}]), /^读取不到 Chrome 的 Cookie/);
  assert.match(C.failureText([{browser: 'safari', login: false}]), /完全磁盘访问权限/);
  assert.match(C.failureText([{browser: 'chrome', login: false}, {browser: 'edge', login: true}]),
    /^试了 2 个浏览器的 Cookie 都没成功（Chrome：读不到 Cookie；Edge：网站仍要求登录）/);
});

test('读不到 Cookie 的补救按 Runtime 所在主机：Windows 上不说系统密钥，说完全退出与应用绑定加密', () => {
  assert.match(C.failureText([{browser: 'chrome', login: false}], 'darwin'), /系统密钥权限/);
  const chrome = C.failureText([{browser: 'chrome', login: false}], 'win32');
  assert.match(chrome, /^读取不到 Chrome 的 Cookie。先完全退出 Chrome（包括在后台运行的）再试；Chrome 用应用绑定加密.*勾选 Firefox。$/);
  assert.doesNotMatch(chrome, /系统密钥/);
  assert.match(C.failureText([{browser: 'opera', login: false}], 'win32'), /先完全退出 Opera.*再试，或换一个浏览器。$/);
  assert.doesNotMatch(C.failureText([{browser: 'opera', login: false}], 'win32'), /应用绑定/);
  assert.match(C.failureText([{browser: 'firefox', login: false}], 'win32'), /^读取不到 Firefox 的 Cookie。确认浏览器已登录、已完全退出/);
});

test('演示挡位与检测结果按主机一一对应；Windows 上没有 Safari', () => {
  for (const platform of ['darwin', 'win32']) {
    assert.deepEqual(C.demoScenes(platform).map((s) => s.k).sort(), Object.keys(C.DEMO_DETECTED[platform]).sort(), platform);
    assert.ok(Object.values(C.DEMO_DETECTED[platform]).every((list) => list.every((b) => C.LABEL[b.id] === b.label)), platform);
  }
  assert.equal(C.demoScenes('win32')[1].label, '只检测到 Edge');
  assert.equal(C.demoScenes('darwin')[1].label, '只检测到 Safari');
  assert.ok(Object.values(C.DEMO_DETECTED.win32).every((list) => list.every((b) => b.id !== 'safari')));
  assert.equal(C.demoDetected('win32', 'one'), C.DEMO_DETECTED.win32.one);
  assert.equal(C.demoDetected('linux', 'bogus'), C.DEMO_DETECTED.darwin.several);
});

test('设置默认带 Cookie：没设置过是所有检测到的浏览器，之后新检测到的也算进去', () => {
  const two = [{id: 'chrome'}, {id: 'safari'}];
  const three = two.concat({id: 'firefox'});
  assert.equal(C.setting({}), C.ALL);
  assert.equal(C.setting(null), C.ALL);
  assert.deepEqual(C.resolve(C.setting({}), two), ['chrome', 'safari']);
  assert.deepEqual(C.resolve(C.ALL, three), ['chrome', 'safari', 'firefox']);
  assert.deepEqual(C.resolve(C.ALL, []), []);
});

test('勾选结果存回设置：全选存 ALL，部分勾选存按检测顺序的列表，都不勾存空列表（匿名下载）', () => {
  const detected = [{id: 'chrome'}, {id: 'safari'}, {id: 'firefox'}];
  assert.equal(C.save(['firefox', 'chrome', 'safari'], detected), C.ALL);
  assert.deepEqual(C.save(['firefox', 'chrome'], detected), ['chrome', 'firefox']);
  assert.deepEqual(C.save([], detected), []);
  assert.deepEqual(C.setting({cookieBrowsers: []}), []);
  assert.deepEqual(C.resolve(C.setting({cookieBrowsers: ['firefox', 'edge']}), detected), ['firefox']);
});

test('Chrome 访问被拒仍列出，未勾选时也提示授权；Windows 不显示 macOS 授权步骤', () => {
  const denied = C.demoDetected('darwin', 'denied');
  assert.deepEqual(C.resolve(C.ALL, denied), ['safari', 'chrome']);
  assert.match(C.notes([], 'darwin', denied).join(''), /没有权限访问 Chrome.*完全磁盘访问权限.*添加并启用 BaoCut.*完全退出并重新打开 BaoCut.*重新检测浏览器/);
  assert.doesNotMatch(C.notes([], 'win32', C.demoDetected('win32', 'denied')).join(''), /完全磁盘访问权限|钥匙串/);
  assert.doesNotMatch(C.notes([], 'darwin', C.demoDetected('darwin', 'several')).join(''), /没有权限/);
});


test('无论是否检测到 Cookie 库，Chrome 都是默认勾选项；手动取消后不强制勾回', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const detected of Object.values(C.DEMO_DETECTED[platform])) {
      assert.ok(C.resolve(C.setting({}), detected).includes('chrome'));
      assert.ok(!C.resolve(C.save(C.resolve(C.ALL, detected).filter((id) => id !== 'chrome'), detected), detected).includes('chrome'));
    }
    assert.match(C.notes(['chrome'], platform, C.demoDetected(platform, 'none')).join(''), /没有找到 Chrome 的 Cookie 库/);
  }
});

test('完全磁盘访问权限：只有 macOS 主机报告「未授权」时才提示，勾选了 Safari 或访问被拒绝的浏览器才算需要', () => {
  assert.deepEqual(C.fullDiskNeeds(['chrome', 'safari'], 'darwin', several, 'missing'), ['safari']);
  assert.deepEqual(C.fullDiskNeeds(['chrome', 'firefox'], 'darwin', several, 'missing'), []);
  assert.deepEqual(C.fullDiskNeeds(['chrome'], 'darwin', C.DEMO_DETECTED.darwin.denied, 'missing'), ['chrome']);
  /* 已授权、没有报告（远端或老版本）、别的系统：都不提示 */
  assert.deepEqual(C.fullDiskNeeds(['safari'], 'darwin', several, 'granted'), []);
  assert.deepEqual(C.fullDiskNeeds(['safari'], 'darwin', several, undefined), []);
  assert.deepEqual(C.fullDiskNeeds(['safari'], 'win32', several, 'missing'), []);
});

test('授权卡的文案：没去过系统设置时点名浏览器，去过之后改说怎么重新启动；跳过就从这次的列表里去掉它们', () => {
  const idle = C.fullDiskCopy(['safari'], 'idle');
  assert.equal(idle.title, '允许 BaoCut 读取 Safari 的 Cookie');
  assert.equal(idle.primary, '打开系统设置');
  assert.equal(idle.secondary, null);
  const opened = C.fullDiskCopy(['safari', 'chrome'], 'opened');
  assert.equal(opened.primary, '重新启动 BaoCut');
  assert.equal(opened.secondary, '再次打开系统设置');
  assert.match(opened.body, /「\+」/);
  assert.deepEqual(C.withoutFullDisk(['chrome', 'safari', 'edge'], ['safari']), ['chrome', 'edge']);
});

test('带授权卡时说明里不再重复去系统设置的步骤；没有授权卡时照旧', () => {
  const withCard = C.notes(['chrome', 'safari'], 'darwin', several, 'missing');
  assert.doesNotMatch(withCard.join(''), /完全磁盘访问权限/);
  assert.match(C.notes(['chrome', 'safari'], 'darwin', several)[3], /完全磁盘访问权限/);
  assert.doesNotMatch(C.notes(['chrome', 'safari'], 'darwin', several, 'granted').join(''), /完全磁盘访问权限/, '已授权时没有要补的步骤');
  const denied = C.DEMO_DETECTED.darwin.denied;
  assert.doesNotMatch(C.notes(['chrome'], 'darwin', denied, 'missing').join(''), /完全磁盘访问权限/);
  assert.match(C.notes(['chrome'], 'darwin', denied).join(''), /完全磁盘访问权限/);
});
