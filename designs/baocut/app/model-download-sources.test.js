const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-local-models.js');
const S = require('./model-download-sources.js');

test('下载来源：两种来源各有内置项，缺省用第一个', () => {
  const st = S.blank();
  assert.deepEqual(S.list(st, 'models').map((s) => s.id), ['hf', 'ms']);
  assert.deepEqual(S.list(st, 'releases').map((s) => s.id), ['gh']);
  assert.equal(S.active(st, 'models').src.name, 'Hugging Face');
  assert.equal(S.active(st, 'releases').src.name, 'GitHub');
});

test('旧的单个基址认回在用的来源', () => {
  assert.equal(S.normalize(null, null).models.active, 'hf');
  assert.equal(S.normalize(null, 'https://www.modelscope.cn').models.active, 'ms');
  const c = S.normalize(null, 'https://hf-mirror.com/');
  assert.deepEqual(c.models, {active: 'm1', mirrors: [{id: 'm1', name: '', base: 'https://hf-mirror.com'}]});
  assert.equal(S.active(c, 'models').src.name, 'hf-mirror.com', '没起名字的镜像显示主机名');
  // 存着的新状态优先于旧值；在用的指向不存在的镜像时退回默认
  assert.equal(S.normalize({models: {active: 'm9', mirrors: []}}, 'https://hf-mirror.com').models.active, 'hf');
});

test('添加镜像：校验地址、拒绝重复，加上就改用它；可以存多个', () => {
  let st = S.blank();
  assert.equal(S.mirrorError(st, 'models', {base: ''}), '填镜像的基址');
  assert.match(S.mirrorError(st, 'models', {base: 'hf-mirror.com'}), /有效/);
  assert.match(S.mirrorError(st, 'models', {base: 'https://huggingface.co/'}), /Hugging Face/, '和内置的重复');
  let r = S.addMirror(st, 'models', {name: '公司镜像', base: 'http://10.0.0.2:8080/hf/'});
  st = r.st;
  assert.equal(r.id, 'm1');
  assert.equal(st.models.active, 'm1');
  r = S.addMirror(st, 'models', {base: 'https://hf-mirror.com'});
  st = r.st;
  assert.equal(r.id, 'm2');
  assert.deepEqual(S.list(st, 'models').map((s) => s.name), ['Hugging Face', 'ModelScope', '公司镜像', 'hf-mirror.com']);
  assert.match(S.mirrorError(st, 'models', {base: 'HTTPS://hf-mirror.com/'}), /重复/);
  assert.equal(S.mirrorError(st, 'models', {base: 'https://hf-mirror.com'}, 'm2'), null, '编辑自己不算重复');
  // 两种来源互不影响
  assert.equal(S.addMirror(st, 'releases', {base: 'https://hf-mirror.com'}).id, 'm1');
});

test('编辑与删除镜像：删掉在用的退回默认', () => {
  let st = S.addMirror(S.blank(), 'models', {base: 'https://a.example'}).st;
  st = S.addMirror(st, 'models', {base: 'https://b.example'}).st;
  st = S.updateMirror(st, 'models', 'm1', {name: 'A', base: 'https://a2.example'});
  assert.deepEqual(st.models.mirrors[0], {id: 'm1', name: 'A', base: 'https://a2.example'});
  let r = S.removeMirror(st, 'models', 'm1');
  assert.equal(r.fellBack, null, '删的不是在用的');
  assert.equal(r.st.models.active, 'm2');
  r = S.removeMirror(r.st, 'models', 'm2');
  assert.equal(r.fellBack, 'Hugging Face');
  assert.equal(r.st.models.active, 'hf');
  assert.equal(S.setActive(r.st, 'models', 'nope'), r.st, '没有的来源不能选');
});

test('环境变量优先且只读；对上已有的就显示那一个', () => {
  const st = S.addMirror(S.blank(), 'models', {name: '公司镜像', base: 'https://a.example'}).st;
  assert.deepEqual([S.active(st, 'models', 'https://www.modelscope.cn').src.id, S.active(st, 'models', 'https://www.modelscope.cn').locked], ['ms', true]);
  assert.equal(S.active(st, 'models', 'https://a.example/').src.name, '公司镜像');
  assert.equal(S.active(st, 'releases', 'https://gh.example').src.name, 'gh.example');
});

const PARTS = [
  {id: 'embedding', name: '模型文件', size: 462, repo: 'litert-community/embeddinggemma-2-740m-litert-lm'},
  {id: 'litertlm-runtime', name: 'LiteRT-LM 运行时', size: 43, release: 'google-ai-edge/LiteRT-LM v0.8.0'},
];

test('下载计划：按来源种类分组，盘上已有的不计入', () => {
  const p = S.plan(PARTS, {});
  assert.deepEqual(p.groups.map((g) => [g.k, g.need]), [['models', 462], ['releases', 43]]);
  assert.equal(p.need, 505);
  const half = S.plan(PARTS, {embedding: true});
  assert.equal(half.need, 43);
  assert.equal(half.kept, 1);
  assert.equal(half.groups[0].parts[0].keep, true);
  assert.ok(S.plan(PARTS, {embedding: true, 'litertlm-runtime': true}).upToDate);
});

test('地址按来源拼：模型仓库按 HF 路径，发布页镜像按「基址/名称/版本」', () => {
  const st = S.addMirror(S.blank(), 'releases', {base: 'https://gh.example/dl'}).st;
  assert.equal(S.partUrl(S.active(S.blank(), 'models').src, PARTS[0]), 'https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm');
  assert.equal(S.partUrl(S.list(st, 'models')[1], PARTS[0]), 'https://www.modelscope.cn/models/litert-community/embeddinggemma-2-740m-litert-lm');
  assert.equal(S.partUrl(S.active(S.blank(), 'releases').src, PARTS[1]), 'https://github.com/google-ai-edge/LiteRT-LM/releases');
  assert.equal(S.partUrl(S.active(st, 'releases').src, PARTS[1]), 'https://gh.example/dl/LiteRT-LM/0.8.0');
});

test('一部分失败：前面下好的留着，失败那一句说清哪一部分、连的哪里', () => {
  const st = S.blank();
  const srcOf = (k) => S.active(st, k).src;
  const p = S.plan(PARTS, {});
  assert.deepEqual(S.simulate(p, srcOf, null), {done: ['embedding', 'litertlm-runtime'], failed: null});
  const r = S.simulate(p, srcOf, 'releases');
  assert.deepEqual(r.done, ['embedding']);
  assert.deepEqual([r.failed.id, r.failed.host], ['litertlm-runtime', 'github.com']);
  assert.match(S.failLine(r.failed, ['模型文件']), /LiteRT-LM 运行时没下成：连不上 github\.com。模型文件已经下好并留着/);
  // 补齐：只剩失败那一部分
  assert.equal(S.plan(PARTS, {embedding: true}).need, 43);
});
