const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-legacy-import.js');
const LI = global.window.BC_LEGACY_IMPORT;

test('默认目录：macOS 与 Linux 在文稿下，Windows 在 Documents 已知文件夹下', () => {
  assert.equal(LI.defaultDest('darwin'), '~/Documents/BaoCut');
  assert.equal(LI.defaultDest('linux'), '~/Documents/BaoCut');
  assert.equal(LI.defaultDest('win32'), 'C:\\Users\\me\\Documents\\BaoCut');
  assert.equal(LI.defaultDest('unknown'), '~/Documents/BaoCut');
});

test('平台沿用 ?platform= 参数，缺省 macOS', () => {
  assert.equal(LI.hostFrom(''), 'darwin');
  assert.equal(LI.hostFrom('?platform=macos-arm64'), 'darwin');
  assert.equal(LI.hostFrom('?platform=windows-x64'), 'win32');
  assert.equal(LI.hostFrom('?legacy=1&platform=linux-x64'), 'linux');
});

test('显示名：POSIX 家目录缩成 ~，Windows 保留盘符与反斜杠', () => {
  assert.equal(LI.label('/Users/jim/Documents/BaoCut/', 'darwin'), '~/Documents/BaoCut');
  assert.equal(LI.label('/home/jim/Documents/BaoCut', 'linux'), '~/Documents/BaoCut');
  assert.equal(LI.label('D:\\BaoCut\\', 'win32'), 'D:\\BaoCut');
  assert.equal(LI.label('\\\\nas\\video\\BaoCut', 'win32'), '\\\\nas\\video\\BaoCut');
  assert.equal(LI.label('', 'win32'), LI.defaultDest('win32'));
});

test('「更改…」的演示候选按平台轮换', () => {
  assert.equal(LI.nextDemoDir('darwin', '~/Documents/BaoCut'), '~/Movies/BaoCut');
  assert.equal(LI.nextDemoDir('darwin', '/Volumes/ExtremeSSD/BaoCut'), '~/Documents/BaoCut');
  assert.equal(LI.nextDemoDir('win32', 'C:\\Users\\me\\Documents\\BaoCut'), 'C:\\Users\\me\\Videos\\BaoCut');
  assert.ok(LI.nextDemoDir('win32', 'D:\\BaoCut').startsWith('C:\\'));
});

test('回答：导入记下目录；跳过不记、下次再问；跳过并勾选不再提醒记下 never', () => {
  const imp = LI.decide('import', false, 'D:\\BaoCut', 8);
  assert.deepEqual(imp.record, {state: 'import', dest: 'D:\\BaoCut'});
  assert.match(imp.toast, /8 个旧版项目/);
  assert.deepEqual(LI.decide('import', true, '~/Documents/BaoCut', 8).record, {state: 'import', dest: '~/Documents/BaoCut'},
    '勾了不再提醒又点导入：照常导入');
  assert.equal(LI.decide('skip', false, '~/Documents/BaoCut', 8).record, null);
  assert.deepEqual(LI.decide('skip', true, '~/Documents/BaoCut', 8).record, {state: 'never'});
});

test('启动时只在发现旧项目且没有决定时询问', () => {
  assert.equal(LI.shouldAsk(8, undefined), true);
  assert.equal(LI.shouldAsk(0, undefined), false);
  assert.equal(LI.shouldAsk(8, {state: 'never'}), false);
  assert.equal(LI.shouldAsk(8, {state: 'import', dest: '~/Documents/BaoCut'}), false);
  assert.equal(LI.shouldAsk(8, {state: 'bogus'}), true, '认不得的记录不算决定');
  assert.equal(LI.demoLaunch('?legacy=1'), true);
  assert.equal(LI.demoLaunch('?platform=windows-x64'), false);
});

test('原型开关上的记录文字', () => {
  assert.equal(LI.recordText(undefined, 'darwin'), '没有记录');
  assert.equal(LI.recordText({state: 'never'}, 'darwin'), '不再提醒');
  assert.equal(LI.recordText({state: 'import', dest: 'D:\\BaoCut'}, 'win32'), '已导入到 D:\\BaoCut');
});
