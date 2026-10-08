const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-home-workspace.js');
require('./model-home-browser.js');
const B = window.BC_HOME_BROWSER;
test('address bar distinguishes searches, public hosts and local development servers', () => {
  assert.equal(B.resolveAddress('example.org/a?b=1'), 'https://example.org/a?b=1');
  assert.equal(B.resolveAddress('example.org:8443/a'), 'https://example.org:8443/a');
  assert.equal(B.resolveAddress('localhost:4333/page'), 'http://localhost:4333/page');
  assert.equal(B.resolveAddress('127.0.0.1:4333'), 'http://127.0.0.1:4333/');
  assert.equal(B.resolveAddress('[::1]:8080'), 'http://[::1]:8080/');
  assert.equal(B.resolveAddress('视频剪辑 tips'), 'https://www.google.com/search?q=' + encodeURIComponent('视频剪辑 tips'));
  for (const input of ['', 'javascript:alert(1)', 'file:///tmp/demo', 'data:text/html,hi', 'https://name:password@example.org']) assert.equal(B.resolveAddress(input), null);
  assert.equal(B.displayUrl('https://example.org/a?q=b#c'), 'example.org/a?q=b#c');
});
test('each tab history supports blank, back, forward and truncation after branching', () => {
  const blank = B.history();
  const a = B.visit(blank, 'https://a.test/'), b = B.visit(a, 'https://b.test/');
  const back = B.step(b, -1);
  assert.equal(back.urls[back.pos], 'https://a.test/');
  assert.deepEqual(B.step(back, 1), b);
  assert.equal(B.visit(back, 'https://a.test/'), back);
  assert.deepEqual(B.visit(back, 'https://c.test/').urls, ['', 'https://a.test/', 'https://c.test/']);
  assert.equal(B.step(blank, -1), blank);
  assert.equal(B.step(b, 1), b);
  assert.deepEqual(blank, {urls:[''],pos:0});
});
test('zoom follows bounded browser steps and can return to 100%', () => {
  assert.equal(B.zoom(100, 1), 110);
  assert.equal(B.zoom(110, -1), 100);
  assert.equal(B.zoom(50, -1), 50);
  assert.equal(B.zoom(200, 1), 200);
});
test('设备尺寸有界，旋转保留宽高，查找跨页切换时可重置', () => {
  assert.deepEqual(B.rotate(B.devices.phone), {width: 844, height: 390});
  assert.equal(B.clampSize(10), 240);
  assert.equal(B.clampSize(9000), 4096);
  assert.deepEqual(B.matches('字幕 Caption 字幕', '字幕'), [0, 11]);
  assert.deepEqual(B.matches('Caption caption', 'CAPTION'), [0, 8]);
  assert.equal(B.nextMatch(0, -1, 3), 2);
  assert.equal(B.nextMatch(2, 1, 3), 0);
  assert.equal(B.nextMatch(0, 1, 0), 0);
  assert.equal(B.demoPage('https://guide.example/subtitles').title, '字幕与交付');
  assert.equal(B.demoPage('https://example.com'), null);
});

test('新建网页 creates a uniquely named HTML document in the session project', () => {
  require('./model-file-preview.js');
  const page = B.newPage([], {id: 'n1', dir: 'd1', session: 's1', now: 5});
  assert.equal(page.name, '新网页.html');
  assert.equal(page.file, page.name);
  assert.equal(page.kind, 'doc');
  assert.equal(page.dir, 'd1');
  assert.equal(page.session, 's1');
  assert.equal(page.ver, 1);
  assert.match(page.text, /^<!doctype html>/);
  assert.equal(window.BC_FILE_PREVIEW.kind(page.file, page.contentKind), 'html');
  const items = [page, {...page, id: 'n2', name: '新网页 2.html', file: '新网页 2.html'}, {id: 'x', name: '新网页 3.html', dir: 'd2'}];
  assert.equal(B.newPage(items, {id: 'n3', dir: 'd1'}).name, '新网页 3.html');
  assert.equal(B.newPage(items, {id: 'n4', dir: 'd2'}).name, '新网页.html');
  assert.equal(B.newPage(items, {id: 'n5'}).dir, null);
});
