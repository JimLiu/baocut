const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {
  window: {React: require('react'), ReactDOM: require('react-dom')},
  console, process, setTimeout, clearTimeout, Intl, URL, AbortController,
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../vendor/react-spectrum-s2/react-spectrum-s2.js'), 'utf8'), context);
const {PromptFieldValue} = context.RSP.AI;

test('vendored AI prompt preserves Chinese references, newlines and full URL context', () => {
  const prompt = new PromptFieldValue([
    {type: 'text', text: '参考 '},
    {type: 'token', text: '@术语表', value: {type: 'custom', anchor: '@', valueType: 'reference', data: '@术语表'}},
    {type: 'text', text: '\n查看 '},
    {type: 'token', text: '链接', value: {type: 'url', url: 'https://example.com/film?id=42'}},
  ]);
  assert.equal(prompt.toString(), '参考 @术语表\n查看 https://example.com/film?id=42');
  assert.equal(prompt.segments.filter(s => s.type === 'token').length, 2);
});

test('external suggestion places the caret at the end and continued editing keeps its text', () => {
  const text = '制作带字幕的视频';
  const prompt = new PromptFieldValue([{type: 'text', text}]).withCaretPosition({index: 0, offset: text.length});
  const next = prompt.replaceRange(prompt.caretPosition, prompt.caretPosition, '，竖屏');
  assert.equal(next.toString(), text + '，竖屏');
  assert.equal(prompt.toString(), text);
});

test('reference tokens survive edits around them and can be removed independently', () => {
  const prompt = new PromptFieldValue([
    {type: 'token', text: '@章节:开场', value: {type: 'custom', anchor: '@', valueType: 'reference', data: 'chapter-1'}},
    {type: 'text', text: ' 翻成英文'},
  ]);
  const next = prompt.replaceRange({index: 1, offset: 5}, {index: 1, offset: 5}, '。');
  assert.equal(next.segments[0].value.data, 'chapter-1');
  assert.equal(next.toString(), '@章节:开场 翻成英文。');
  const removed = next.replaceRange({index: 0, offset: 0}, {index: 0, offset: 1}, '');
  assert.equal(removed.toString(), ' 翻成英文。');
});

/* 待填项（template-spec §5.5）：PromptField 用 BC_PROMPT_SLOTS 在草稿字符串与 S2 占位 token 之间往返。 */
const SLOTS = require('../app/model-prompt-slots.js');
const isSlot = (s) => s.type === 'token' && s.value?.type === 'placeholder' && s.value.placeholderType === 'text';

test('placeholder tokens round-trip between the draft string and PromptFieldValue', () => {
  for (const text of ['', '给{{产品或服务}}做一条推广，面向{{受众}}。', '{{a}}{{b}}', '第一行{{a}}\n第二行 https://example.com/x 结尾', '没闭合的 {{受众']) {
    const prompt = new PromptFieldValue(SLOTS.toTokens(text));
    assert.equal(SLOTS.fromTokens(prompt.segments), text, JSON.stringify(text));
  }
  const prompt = new PromptFieldValue(SLOTS.toTokens('{{a}}{{b}}'));
  assert.deepEqual(prompt.segments.map(isSlot), [true, true], '相邻占位符各是一个 token');
  assert.equal(prompt.toString(), 'ab', 'S2 的 toString 只取 label，所以序列化不能用它');
});

test('typing over one placeholder turns it into text and keeps the others as tokens', () => {
  const text = '给{{产品或服务}}做一条推广，面向{{受众}}。';
  const prompt = new PromptFieldValue(SLOTS.toTokens(text));
  const i = prompt.segments.findIndex(isSlot);
  const range = new PromptFieldValue.SelectedRange({index: i, offset: 0}, {index: i, offset: prompt.segments[i].text.length});
  const selected = prompt.withSelectedRange(range);
  const next = selected.replaceRange(selected.selectedRange.start, selected.selectedRange.end, '降噪耳机');
  assert.equal(SLOTS.fromTokens(next.segments), '给降噪耳机做一条推广，面向{{受众}}。');
  assert.deepEqual(SLOTS.labels(SLOTS.fromTokens(next.segments)), ['受众']);
  assert.equal(next.segments.filter(isSlot).length, 1);
  assert.equal(SLOTS.nextSlot(next.segments, next.caretPosition.index), next.segments.findIndex(isSlot), '「填下一处」跳到剩下的那个');
  const removed = next.replaceRange({index: SLOTS.nextSlot(next.segments, -1), offset: 0}, {index: SLOTS.nextSlot(next.segments, -1), offset: 1}, '');
  assert.equal(SLOTS.fromTokens(removed.segments), '给降噪耳机做一条推广，面向。', '删掉占位 token 就是删掉这一处');
  assert.equal(SLOTS.nextSlot(removed.segments, 0), -1);
});
