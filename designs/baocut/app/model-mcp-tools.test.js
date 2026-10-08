const test = require('node:test');
const assert = require('node:assert');
const M = require('./model-mcp-tools.js');

test('工具名唯一、snake_case，描述与分组齐全', () => {
  const names = M.TOOLS.map((t) => t.name);
  assert.strictEqual(new Set(names).size, names.length);
  const groups = M.GROUPS.map((g) => g.k);
  M.TOOLS.forEach((t) => {
    assert.match(t.name, /^[a-z]+(_[a-z]+)*$/);
    assert.ok(t.desc && t.title, t.name);
    assert.ok(groups.indexOf(t.group) >= 0, t.name);
  });
});

test('没有不透明参数：每个字段有类型与说明，object 必带字段，array 必带 items', () => {
  const walk = (p, where) => {
    assert.ok(p.desc, where + '.' + p.name + ' 缺说明');
    assert.ok(['string', 'number', 'integer', 'boolean', 'array', 'object'].indexOf(p.type) >= 0, where + '.' + p.name);
    if (p.type === 'object') { assert.ok(p.fields && p.fields.length, where + '.' + p.name + ' 是空 object'); p.fields.forEach((f) => walk(f, where + '.' + p.name)); }
    if (p.type === 'array') { assert.ok(p.items, where + '.' + p.name + ' 缺 items'); if (p.items.type === 'object') p.items.fields.forEach((f) => walk(f, where + '.' + p.name + '[]')); }
  };
  M.TOOLS.forEach((t) => t.params.forEach((p) => walk(p, t.name)));
});

test('项目是参数：list_projects 给 id，其余工具第一个参数是必填的 project（任务查询除外）', () => {
  assert.strictEqual(M.TOOLS[0].name, 'list_projects');
  M.TOOLS.forEach((t) => {
    const p = t.params.find((x) => x.name === 'project');
    if (['list_projects', 'get_job', 'list_tts_models', 'list_image_models', 'cancel_job'].indexOf(t.name) >= 0) assert.strictEqual(p, undefined, t.name);
    else if (['list_jobs', 'synthesize_speech', 'generate_image'].indexOf(t.name) >= 0) assert.ok(p && !p.required, t.name);
    else { assert.strictEqual(t.params[0].name, 'project', t.name); assert.ok(p.required, t.name); }
  });
  assert.deepStrictEqual(M.withProject({project: '$project', lang: 'en'}, 'p7'), {project: 'p7', lang: 'en'});
  assert.deepStrictEqual(M.withProject({}, 'p7'), {});
});

test('inputSchema：required、枚举、范围与嵌套', () => {
  const s = M.inputSchema(M.byName('get_transcript'));
  assert.strictEqual(s.type, 'object');
  assert.strictEqual(s.additionalProperties, false);
  assert.deepStrictEqual(s.required, ['project']);
  assert.deepStrictEqual([s.properties.limit.minimum, s.properties.limit.maximum, s.properties.limit.default], [1, 500, 20]);
  const e = M.inputSchema(M.byName('export'));
  assert.deepStrictEqual(e.required, ['project', 'kind']);
  assert.deepStrictEqual(e.properties.kind.enum, ['mp4', 'srt', 'vtt']);
  assert.deepStrictEqual(e.properties.range.required, ['from', 'to']);
  const t = M.inputSchema(M.byName('edit_translation'));
  assert.deepStrictEqual(t.required, ['project', 'lang', 'edits']);
  assert.deepStrictEqual(t.properties.edits.items.required, ['sentenceId', 'text']);
  assert.strictEqual(t.properties.edits.maxItems, 200);
  assert.strictEqual(M.inputSchema(M.byName('list_projects')).required, undefined);
});

test('注解：读取类 readOnly，写入类按破坏性 / 幂等标注', () => {
  assert.strictEqual(M.annotations(M.byName('get_timeline')).readOnlyHint, true);
  const a = M.annotations(M.byName('edit_transcript'));
  assert.deepStrictEqual([a.readOnlyHint, a.destructiveHint, a.idempotentHint], [false, false, false]);
  assert.strictEqual(M.annotations(M.byName('start_transcribe')).destructiveHint, true);
  assert.strictEqual(M.annotations(M.byName('set_chapters')).idempotentHint, true);
  const d = M.descriptor(M.byName('export'));
  assert.deepStrictEqual(Object.keys(d), ['name', 'description', 'inputSchema', 'annotations']);
});

test('去向：只读权限下写工具不进 tools/list，关掉的也不进', () => {
  const rd = M.byName('get_project'), wr = M.byName('cut_ranges');
  assert.strictEqual(M.gate(rd, 'read', []), 'auto');
  assert.strictEqual(M.gate(wr, 'read', []), 'hidden');
  assert.strictEqual(M.gate(wr, 'ask', []), 'ask');
  assert.strictEqual(M.gate(rd, 'ask', ['get_project']), 'off');
  const reads = M.TOOLS.filter((t) => !M.isWrite(t)).length;
  assert.strictEqual(M.exposed('read', []).length, reads);
  assert.strictEqual(M.exposed('ask', []).length, M.TOOLS.length);
  assert.strictEqual(M.exposed('ask', ['export', 'get_job']).length, M.TOOLS.length - 2);
  assert.strictEqual(M.summary('read', []), '提供 ' + reads + ' / ' + M.TOOLS.length + ' 个工具 · 全部只读');
  assert.match(M.summary('ask', []), /个调用前询问$/);
  assert.strictEqual(M.summary('read', M.TOOLS.map((t) => t.name)), '没有提供任何工具');
});

test('实参校验：必填、类型、枚举、范围、多余参数', () => {
  assert.deepStrictEqual(M.validate('get_transcript', {project: 'p1', lang: 'en', limit: 200}), []);
  assert.deepStrictEqual(M.validate('export', {project: 'p1'}), ['缺少必填参数 kind']);
  assert.deepStrictEqual(M.validate('export', {project: 'p1', kind: 'mov'}), ['kind 只能是 mp4 / srt / vtt']);
  assert.deepStrictEqual(M.validate('get_transcript', {project: 'p1', limit: 900}), ['limit 不能大于 500']);
  assert.deepStrictEqual(M.validate('get_transcript', {project: 'p1', limit: 1.5}), ['limit 应为 integer']);
  assert.deepStrictEqual(M.validate('edit_transcript', {project: 'p1', edits: []}), ['edits 至少 1 项']);
  assert.deepStrictEqual(M.validate('get_project', {}), ['缺少必填参数 project']);
  assert.deepStrictEqual(M.validate('list_projects', {project: 'p1'}), ['多余的参数 project']);
  assert.deepStrictEqual(M.validate('nope', {}), ['未知工具 nope']);
});

test('显示：类型短写与请求行', () => {
  const t = M.byName('edit_transcript');
  assert.strictEqual(M.typeLabel(t.params[1]), '{cueId, text}[]');
  assert.strictEqual(M.typeLabel(M.byName('edit_translation').params[2]), '{sentenceId, text}[]');
  assert.strictEqual(M.typeLabel(M.byName('export').params[1]), '"mp4" | "srt" | "vtt"');
  assert.strictEqual(M.typeLabel(M.byName('get_transcript').params.find(p => p.name === 'limit')), 'integer 1–500');
  assert.strictEqual(M.callLine('list_projects', {}), 'list_projects');
  assert.strictEqual(M.callLine('edit_translation', {lang: 'en', edits: [1, 2, 3]}), 'edit_translation {lang: "en", edits: [3 项]}');
});

test('演示调用都是目录里的工具，实参过得了校验；等确认的那条是写工具', () => {
  M.DEMO.requests.filter((r) => r.tool).concat([M.DEMO.pending]).forEach((r) => {
    assert.deepStrictEqual(M.validate(r.tool, r.args), [], r.tool);
  });
  assert.ok(M.isWrite(M.byName(M.DEMO.pending.tool)));
});

test('长项目读取默认精简、有预算，目录和搜索能翻页', () => {
  const props = M.inputSchema(M.byName('get_transcript')).properties;
  assert.equal(props.limit.default, 20);
  assert.equal(props.includeCues.default, false);
  assert.equal(props.maxBytes.default, 16384);
  for (const tool of ['list_projects', 'search_transcript']) assert.ok(M.inputSchema(M.byName(tool)).properties.cursor);
});

test('直接放行：写入与生成不用确认；cancel_job 在修改前询问下也直接执行；只读下都不提供', () => {
  const wr = M.byName('edit_translation'), gen = M.byName('generate_image'), cancel = M.byName('cancel_job');
  assert.strictEqual(M.gate(wr, 'auto', []), 'auto');
  assert.strictEqual(M.gate(gen, 'auto', []), 'auto');
  assert.strictEqual(M.gate(gen, 'ask', []), 'ask');
  assert.strictEqual(M.gate(gen, 'read', []), 'hidden');
  assert.strictEqual(M.gate(cancel, 'ask', []), 'auto');
  assert.strictEqual(M.gate(cancel, 'read', []), 'hidden');
  assert.strictEqual(M.gate(wr, 'auto', ['edit_translation']), 'off');
  assert.strictEqual(M.gateLabel('auto', M.byName('get_job')), '直接应答');
  assert.strictEqual(M.gateLabel('auto', wr), '直接执行');
  assert.strictEqual(M.exposed('auto', []).length, M.TOOLS.length);
  assert.strictEqual(M.summary('auto', []), '提供 ' + M.TOOLS.length + ' / ' + M.TOOLS.length + ' 个工具 · 不需要确认');
  const asks = M.TOOLS.filter((t) => M.isWrite(t) && !t.direct).length;
  assert.strictEqual(M.summary('ask', []), '提供 ' + M.TOOLS.length + ' / ' + M.TOOLS.length + ' 个工具 · ' + asks + ' 个调用前询问');
});

test('生成组：不需要项目，输出只能给文件名，参考图要和项目一起给', () => {
  assert.deepStrictEqual(M.GROUPS.map((g) => g.k), ['read', 'edit', 'job', 'generate']);
  assert.deepStrictEqual(M.groups().find((g) => g.k === 'generate').tools.map((t) => t.name), ['synthesize_speech', 'generate_image']);
  assert.deepStrictEqual(M.inputSchema(M.byName('synthesize_speech')).required, ['text']);
  assert.deepStrictEqual(M.inputSchema(M.byName('generate_image')).required, ['prompt']);
  ['synthesize_speech', 'generate_image'].forEach((n) => {
    const props = M.inputSchema(M.byName(n)).properties;
    assert.ok(props.name && props.project, n);
    ['out', 'refAudio', 'emotionAudio', 'textFile'].forEach((k) => assert.strictEqual(props[k], undefined, n + '.' + k));
  });
  assert.deepStrictEqual(M.validate('generate_image', {prompt: '一只纸鹤', size: [1024, 1024], n: 2}), []);
  assert.deepStrictEqual(M.validate('generate_image', {prompt: 'x', n: 20}), ['n 不能大于 16']);
  assert.strictEqual(M.TOOLS.length, 22);
});
