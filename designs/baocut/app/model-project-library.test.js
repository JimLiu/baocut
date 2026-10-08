const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-project-library.js');
const LIB = window.BC_LIBRARY;

test('归档与恢复保持内容、顺序和修改时间；旧项目默认在当前列表', () => {
  const projects = [{id: 'p1', title: '访谈', mtime: 50, content: {paras: [{text: '原稿'}]}}, {id: 'p2', archived: true}];
  const archived = LIB.setArchived(projects, 'p1', true);
  assert.deepEqual(LIB.visible(projects, false).map((p) => p.id), ['p1']);
  assert.deepEqual(LIB.visible(archived, false), []);
  assert.deepEqual(LIB.visible(archived, true).map((p) => p.id), ['p1', 'p2']);
  assert.equal(archived[0].content, projects[0].content);
  assert.equal(archived[0].mtime, 50);
  assert.equal(projects[0].archived, undefined);
  assert.deepEqual(LIB.visible(LIB.setArchived(archived, 'p1', false), false).map((p) => p.id), ['p1']);
});

test('归档项目可以克隆；内容独立、外部媒体引用保留、副本默认未归档', () => {
  const source = {id: 'p1', title: '访谈', archived: true, status: 'complete',
    src: {path: '/Movies/访谈.mp4'}, content: {paras: [{text: '原稿'}]}, config: {lang: 'zh'}};
  const clone = LIB.clone([source], 'p1', 'p2');
  assert.equal(clone.id, 'p2');
  assert.equal(clone.title, '访谈 副本');
  assert.equal(clone.archived, false);
  assert.equal(clone.src.path, source.src.path);
  clone.content.paras[0].text = '副本编辑';
  clone.config.lang = 'en';
  assert.equal(source.content.paras[0].text, '原稿');
  assert.equal(source.config.lang, 'zh');
});

test('克隆名称避开当前与归档项目，重复 ID 和已删除源不创建副本', () => {
  const projects = [{id: 'p1', title: '访谈'}, {id: 'p2', title: '访谈 副本', archived: true}, {id: 'p3', title: '访谈 副本 2'}];
  assert.equal(LIB.clone(projects, 'p1', 'p4').title, '访谈 副本 3');
  assert.equal(LIB.clone(projects, 'p1', 'p2'), null);
  assert.equal(LIB.clone(projects, 'deleted', 'p4'), null);
});

test('克隆进行中项目只保留已有内容，不继承任务或进度', () => {
  for (const status of ['transcribing', 'queued', 'error']) {
    const source = {id: 'p1', title: '访谈', status, progress: 50, queuePos: 2, taskId: 'j1', jobId: 'j1', sessionId: 's1', error: '旧失败'};
    const clone = LIB.clone([source], 'p1', 'p2');
    assert.equal(clone.status, 'ready');
    for (const key of ['progress', 'queuePos', 'taskId', 'jobId', 'sessionId', 'error']) assert.equal(key in clone, false);
    source.content = {paras: [{text: '已保存的稿子'}]};
    assert.equal(LIB.clone([source], 'p1', 'p3').status, 'complete');
    assert.equal(source.status, status);
  }
});
