const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-file-preview.js');
const F = window.BC_FILE_PREVIEW;

test('常用格式按预览能力归类', () => {
  assert.deepEqual(['report.PDF', 'index.html', 'table.csv', 'table.tsv', 'data.json', 'note.md', 'main.py'].map(name => F.kind(name)),
    ['pdf', 'html', 'table', 'table', 'json', 'markdown', 'text']);
});
test('CSV 保留引号里的逗号、换行和双引号，支持 BOM 与 CRLF', () => {
  assert.deepEqual(F.table('\uFEFFname,note\r\na,"one,two"\r\nb,"first\nsecond"\r\nc,"say ""hello"""\r\n', ',').rows,
    [['name', 'note'], ['a', 'one,two'], ['b', 'first\nsecond'], ['c', 'say "hello"']]);
  assert.deepEqual(F.table('a\tb\n1\t\n', '\t').rows, [['a', 'b'], ['1', '']]);
  assert.equal(F.table('a,"unfinished', ',').rows.length, 0);
  assert.ok(F.table('a,"unfinished', ',').error);
});
test('JSON 解析失败保留原文', () => {
  assert.equal(F.json('{"a":1}').text, '{\n  "a": 1\n}');
  assert.equal(F.json('{broken').text, '{broken');
  assert.ok(F.json('{broken').error);
});
test('文件链接按所属项目匹配，不能打开其他项目同名条目或回收站文件', () => {
  const files = [{id: 'a', dir: 'd1', file: '制作简报.pdf'}, {id: 'b', dir: 'd2', file: '制作简报.pdf'}, {id: 'c', dir: 'd1', file: 'gone.pdf', trashed: true}];
  assert.equal(F.linkedFile('./' + encodeURIComponent('制作简报.pdf'), files, 'd1').id, 'a');
  assert.equal(F.linkedFile('gone.pdf', files, 'd1'), null);
  assert.equal(F.linkedFile('%ZZ', files, 'd1'), null);
});

test('内容识别优先于扩展名，未知文本、二进制与伪装后缀分别回退', () => {
  assert.equal(F.kind('README', 'text'), 'text');
  assert.equal(F.kind('说明.abc', 'text'), 'text');
  assert.equal(F.kind('fake.pdf', 'text'), 'text');
  assert.equal(F.kind('report.abc', 'pdf'), 'pdf');
  assert.equal(F.kind('fake.txt', 'binary'), null);
  assert.equal(F.kind('archive.any', 'archive'), null);
});
