const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-question.js');
const Q = global.window.BC_AGENT_QUESTION;

const QUESTIONS = [
  {id: 'q1', header: '风格', question: '片头音乐想要什么感觉？', options: [{label: '轻快'}, {label: '沉稳'}], multiSelect: false},
  {id: 'q2', header: '位置', question: '放在哪几段？', options: [{label: '片头'}, {label: '片尾'}], multiSelect: true},
];

test('draftAnswers：每题都答了才有答案；单选只取第一个，多选去重', () => {
  assert.equal(Q.draftAnswers(QUESTIONS, {picked: {q1: ['轻快']}}), null);
  assert.deepEqual(Q.draftAnswers(QUESTIONS, {picked: {q1: ['轻快', '沉稳'], q2: ['片头', '片尾', '片头']}}),
    {q1: ['轻快'], q2: ['片头', '片尾']});
  assert.deepEqual(Q.draftAnswers([], {}), {});
});

test('draftAnswers：选了「其他」要写了字才算答了，写的字代替「其他」', () => {
  assert.equal(Q.draftAnswers(QUESTIONS, {picked: {q1: [Q.OTHER], q2: ['片头']}, other: {q1: '  '}}), null);
  assert.deepEqual(Q.draftAnswers(QUESTIONS, {picked: {q1: [Q.OTHER], q2: ['片头', Q.OTHER]}, other: {q1: ' 爵士 ', q2: '转场'}}),
    {q1: ['爵士'], q2: ['片头', '转场']});
});

test('draftAnswers：填空题没有选项，写的字就是答案，空白不算', () => {
  const qs = [QUESTIONS[0], {id: 'q3', header: '标题', question: '封面标题写什么？', options: [], multiSelect: false}];
  assert.equal(Q.isFillIn(qs[1]), true);
  assert.equal(Q.isFillIn(qs[0]), false);
  assert.equal(Q.draftAnswers(qs, {picked: {q1: ['轻快']}, other: {q3: '   '}}), null);
  assert.deepEqual(Q.draftAnswers(qs, {picked: {q1: ['轻快']}, other: {q3: ' 三分钟看懂剪辑 '}}), {q1: ['轻快'], q3: ['三分钟看懂剪辑']});
});

test('answerText、stateLabel、replyFor、pendingSummary', () => {
  assert.equal(Q.answerText({q2: ['片头', '片尾']}, 'q2'), '片头、片尾');
  assert.equal(Q.answerText({}, 'q1'), '没有回答');
  assert.equal(Q.stateLabel('byMessage'), '已在输入框回复');
  assert.equal(Q.stateLabel('pending'), '');
  assert.match(Q.replyFor(QUESTIONS, {q1: ['轻快'], q2: ['片头']}), /风格：轻快；位置：片头/);
  assert.equal(Q.pendingSummary({questions: QUESTIONS}), '等你回答 · 风格');
  assert.equal(Q.pendingSummary({questions: []}), '等你回答 · 提问');
});
