const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-surface.js');
require('./model-stage-media.js');
const M = global.window.BC_STAGE_MEDIA;
const APP = global.window.BC_SURFACE.make('app');
const WEB = global.window.BC_SURFACE.make('web');

const gone = {src: {name: 'interview-feb.mp4', path: '/Volumes/素材盘/interview-feb.mp4', state: 'missing'}};
const fine = {src: {name: 'talk.mp4', path: '/Users/me/talk.mp4', state: 'ok'}};

test('跟项目数据：源文件标了 missing 才出卡，好的与没有主媒体的都不出', () => {
  assert.equal(M.problemOf(gone, 'auto'), 'missing');
  assert.equal(M.problemOf(fine, 'auto'), null);
  assert.equal(M.problemOf({entry: 'blank'}, 'missing'), null, '没有主媒体的项目不算问题');
  assert.equal(M.problemOf(gone, 'ok'), null, '原型开关可以强制关掉');
  assert.equal(M.problemOf(fine, 'unplayable'), 'unplayable');
});

test('卡片点名文件名，不点整条路径', () => {
  assert.equal(M.notice(gone, 'auto', APP).name, 'interview-feb.mp4');
  assert.equal(M.fileName('C:\\clips\\a.mov'), 'a.mov');
  assert.equal(M.fileName(''), '');
});

test('字幕照常播：两种情形的正文都要说出来', () => {
  const miss = M.notice(gone, 'auto', APP);
  const bad = M.notice(fine, 'unplayable', APP);
  assert.equal(miss.title, '找不到源文件');
  assert.match(miss.body, /字幕照常可以播放/);
  assert.match(bad.body, /字幕照常可以播放/);
  assert.ok(bad.body.includes(M.DEMO_ERROR), '放不出时附播放器原话');
});

test('找回画面的去处：只在 App 且文件缺失时说', () => {
  assert.equal(M.notice(gone, 'auto', APP).hint, M.RELINK_HINT);
  assert.equal(M.notice(gone, 'auto', WEB).hint, null, 'Web 没有重新关联入口（§22）');
  assert.equal(M.notice(fine, 'unplayable', APP).hint, null, '文件还在，项目卡上没有那一项');
});
