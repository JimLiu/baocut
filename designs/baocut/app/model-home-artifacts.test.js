const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-home-artifacts.js');
const A = window.BC_HOME_ARTIFACTS;

test('类型名与图标：八种自带类型各有一个，认不出的退回「作品」与设计稿图标', () => {
  assert.equal(A.typeLabel('slides'), '幻灯片');
  assert.equal(A.iconName('sheets'), 'Table');
  assert.equal(A.typeLabel('custom-board'), '作品');
  assert.equal(A.iconName(undefined), 'Shapes');
  assert.equal(A.typeLabel('toString'), '作品');
  assert.equal(A.cardDetail({type: 'docs'}), '文档');
});

test('作品链接与 id 互换，别的链接不认', () => {
  assert.equal(A.urlOf('art-1'), 'open-artifact://artifact/art-1');
  assert.equal(A.idOf('open-artifact://artifact/art-1'), 'art-1');
  assert.equal(A.idOf('open-artifact://artifact/'), null);
  assert.equal(A.idOf('https://example.com/art-1'), null);
  assert.equal(A.idOf(null), null);
});

test('find 取所有会话里最近一次回执；没有标题时标签叫「未命名作品」', () => {
  const url = A.urlOf('art-1');
  const sessions = [
    {id: 's1', messages: [{role: 'artifact', url, title: '初稿', type: 'slides'}, {role: 'assistant', text: 'x'}]},
    {id: 's2', messages: [{role: 'artifact', url: A.urlOf('art-2'), title: '', type: 'docs', taskId: 't1'}]},
    {id: 's1b', messages: [{role: 'artifact', url, title: '修订', type: 'slides'}]},
  ];
  assert.deepEqual(A.find(sessions, 'art-1'), {id: 'art-1', url, title: '修订', type: 'slides', taskId: null, session: 's1b'});
  assert.equal(A.find(sessions, 'art-2').taskId, 't1');
  assert.equal(A.find(sessions, 'missing'), null);
  assert.equal(A.tabTitle(A.find(sessions, 'art-2')), '未命名作品');
  assert.equal(A.tabTitle(null), '未命名作品');
});

test('/artifacts 命令：开头、不分大小写、后面是空白或结束', () => {
  assert.ok(A.isCommand('/artifacts'));
  assert.ok(A.isCommand('  /Artifacts 做个课件'));
  assert.ok(A.isCommand('/ARTIFACTS\n做个课件'));
  assert.ok(!A.isCommand('/artifactsx'));
  assert.ok(!A.isCommand('请用 /artifacts'));
  assert.equal(A.request('/artifacts  做个课件 '), '做个课件');
});

test('replyPlan：读 skill、建作品、回执用一个没用过的 id', () => {
  const taken = [{id: 's1', messages: [{role: 'artifact', url: A.urlOf('art-new-1')}]}];
  const plan = A.replyPlan('/artifacts 做一份 8 页的课件。版式素一点', taken);
  assert.equal(plan.kind, 'artifact');
  assert.equal(plan.reads.length, 2);
  assert.match(plan.reads[0].cmd, /skill artifacts/);
  assert.deepEqual(plan.artifact, {url: A.urlOf('art-new-2'), title: '做一份 8 页的课件', type: 'slides', taskId: null});
  assert.equal(A.replyPlan('/artifacts', []).artifact.title, '新作品');
  assert.equal(A.replyPlan('/artifacts 落地页', []).artifact.type, 'design');
  assert.equal(A.replyPlan('/artifacts 发布计划文档', []).artifact.type, 'docs');
});
