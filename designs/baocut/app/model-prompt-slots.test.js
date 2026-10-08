const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global.window || {};
const P = require('./model-prompt-slots.js');

const CASES = [
  '',
  '没有占位符的一句话',
  '给{{产品或服务}}做一条推广，面向{{受众}}。',
  '{{a}}{{b}}',
  '开头{{a}}\n第二行{{b}}结尾',
  '没闭合的 {{受众 后面还有字',
  '空的 {{}} 不算',
  '{{目标 受众}} 带空格',
  '{{{a}}}',
  '{{跨\n行}}',
  '{{a}b}}',
];

test('parse ↔ serialize 严格往返（PromptField 靠它判断要不要重建）', () => {
  CASES.forEach((s) => assert.equal(P.serialize(P.parse(s)), s, JSON.stringify(s)));
});

test('parse：相邻占位符、换行、label 含空格；不产生空的文字片段', () => {
  assert.deepEqual(P.parse(''), []);
  assert.deepEqual(P.parse('{{a}}{{b}}'), [{type: 'slot', label: 'a'}, {type: 'slot', label: 'b'}]);
  assert.deepEqual(P.parse('开头{{a}}\n第二行'), [{type: 'text', text: '开头'}, {type: 'slot', label: 'a'}, {type: 'text', text: '\n第二行'}]);
  assert.deepEqual(P.parse('{{目标 受众}}'), [{type: 'slot', label: '目标 受众'}]);
  assert.deepEqual(P.parse('{{ 受众 }}'), [{type: 'slot', label: ' 受众 '}], 'label 原样，不修剪');
  P.parse('{{a}}x{{b}}').forEach((x) => assert.ok(x.type === 'slot' || x.text.length > 0));
});

test('parse：没闭合的 {{、空的 {{}}、跨行与带括号的都按文字留着', () => {
  assert.deepEqual(P.parse('没闭合的 {{受众'), [{type: 'text', text: '没闭合的 {{受众'}]);
  assert.deepEqual(P.parse('空的 {{}}'), [{type: 'text', text: '空的 {{}}'}]);
  assert.deepEqual(P.parse('{{跨\n行}}'), [{type: 'text', text: '{{跨\n行}}'}]);
  assert.deepEqual(P.parse('{{{a}}}'), [{type: 'text', text: '{'}, {type: 'slot', label: 'a'}, {type: 'text', text: '}'}]);
  assert.deepEqual(P.parse('{{ {{a}}'), [{type: 'text', text: '{{ '}, {type: 'slot', label: 'a'}]);
});

test('labels：去重、按出现顺序', () => {
  assert.deepEqual(P.labels('给{{产品}}做，面向{{受众}}，再说一次{{产品}}'), ['产品', '受众']);
  assert.deepEqual(P.labels('都填好了'), []);
  assert.deepEqual(P.labels(null), []);
});

test('forAgent：没填的写成 [label]，其余原样', () => {
  assert.equal(P.forAgent('给{{产品或服务}}做一条推广，面向{{受众}}。'), '给[产品或服务]做一条推广，面向[受众]。');
  assert.equal(P.forAgent('{{a}}{{b}}\n{{c'), '[a][b]\n{{c');
  assert.equal(P.forAgent('没有占位符'), '没有占位符');
});

test('example：占位符换成 example，缺 example 用 label', () => {
  const fields = [{label: '产品或服务', hint: '卖什么', example: '一款降噪耳机'}, {label: '受众'}];
  assert.equal(P.example('给{{产品或服务}}做一条推广，面向{{受众}}。', fields), '给一款降噪耳机做一条推广，面向受众。');
  assert.equal(P.example('{{产品或服务}}', null), '产品或服务');
  assert.equal(P.example('', fields), '');
});
