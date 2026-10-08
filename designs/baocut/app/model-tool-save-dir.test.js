const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('./model-tool-save-dir.js');
const S = window.BC_SAVE_DIR;

test('没设过时是系统下载文件夹；设了用设置；「更改…」只盖这一次', () => {
  assert.equal(S.setting({}), '~/Downloads');
  assert.equal(S.setting({saveDir: '  '}), '~/Downloads');
  assert.equal(S.setting({saveDir: '/Volumes/Work/out'}), '/Volumes/Work/out');
  assert.equal(S.current({saveDir: '/Volumes/Work/out'}, '/tmp/x'), '/tmp/x');
  assert.equal(S.current({}, ''), '~/Downloads');
  assert.equal(S.isDefault({}), true);
  assert.equal(S.isDefault({saveDir: '/a'}), false);
});

test('显示名：家目录缩成 ~，深路径只留最后两级', () => {
  assert.equal(S.label('/Users/me/Downloads'), '~/Downloads');
  assert.equal(S.label('/home/me/Movies/out/'), '~/Movies/out');
  assert.equal(S.label('/Volumes/Work/2026/clips/final'), '/…/clips/final');
  assert.equal(S.label(''), '~/Downloads');
});
