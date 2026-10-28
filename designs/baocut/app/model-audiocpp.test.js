const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-audiocpp-catalog.js');
require('./model-audiocpp.js');
const A = window.BC_AUDIOCPP;
const C = window.BC_AUDIOCPP_CATALOG;
const fam = (f) => C.families.find((x) => x.f === f);

test('目录：每一族有分组，能添加的两组都有包，配件不单列', () => {
  assert.ok(C.families.length >= 100);
  const groups = new Set(C.families.map(A.groupOf));
  assert.deepEqual([...groups].sort(), ['idle', 'music', 'tts']);
  const yue = fam('yue2');
  assert.ok(A.pkgsOf(yue).every((p) => !p.part));
  assert.equal(A.defaultPkg(yue).builtin, 'yue2-3b');
  // 每个包的配件都在同一族里
  C.families.forEach((f) => (f.pkgs || []).forEach((p) => assert.equal(A.partsOf(f, p).length, (p.needs || []).length, p.id)));
});

test('分组与原因：识别、分离、其余任务各有一句', () => {
  assert.equal(A.groupOf(fam('qwen3_tts')), 'tts');
  assert.equal(A.groupOf(fam('yue2')), 'music');
  const asr = C.families.find((f) => f.cap === 'asr');
  assert.equal(A.groupOf(asr), 'idle');
  assert.match(A.idleReason(asr), /识别模型/);
  const other = C.families.find((f) => f.cap === 'other' && f.tasks.length);
  assert.match(A.idleReason(other), /还没有用到/);
});

test('特点与语言一句', () => {
  assert.equal(A.traitsLine(fam('qwen3_tts')), '克隆 · 按描述造声 · 9 个内置音色 · 可写风格 · 中 / 英 / 日 / 韩 等 10 种语言');
  assert.equal(A.langLine({langs: ['auto']}), '自动认语言');
  assert.equal(A.langLine({langs: 23}), '23 种语言');
  assert.equal(A.langLine({langs: ['50+ languages']}), '50 种以上语言');
  assert.equal(A.langLine({langs: ['auto', 'zh', 'en']}), '中 / 英');
  assert.equal(A.langLine({langs: ['multilingual']}), '多语言');
  assert.equal(A.langLine({langs: ['51 languages']}), '51 种语言');
  // 目录里每一族的语言一句都不留英文说法
  C.families.forEach((f) => assert.doesNotMatch(A.langLine(f), /languages|multilingual|_/, f.f));
});

test('许可四档：可商用、不可商用、条件与不明都有说法；表里没有的写未标许可', () => {
  assert.equal(A.licenseOf(fam('qwen3_tts')).commercialUse, true);
  const nc = A.licenseOf(fam('yue2'));
  assert.equal(nc.commercialUse, false);
  assert.equal(A.licenseFlag(nc), 'nc');
  const none = A.licenseOf({lic: null});
  assert.equal(none.name, '未标许可');
  assert.equal(A.licenseFlag(none), 'check');
  assert.equal(A.licenseOf({lic: {name: 'X', commercial: 'conditional'}}).commercialUse, null);
});

test('包状态：内置的指向内置 id，加过的指向添加行', () => {
  const q = fam('qwen3_tts');
  const builtin = q.pkgs.find((p) => p.builtin);
  assert.deepEqual(A.stateOf(builtin, []), {kind: 'builtin', id: builtin.builtin});
  const bf16 = q.pkgs.find((p) => p.id === 'qwen3_tts_1_7b_base_bf16');
  assert.equal(A.stateOf(bf16, []), null);
  assert.deepEqual(A.stateOf(bf16, [{id: 'audiocpp:qwen3_tts_1_7b_base_bf16'}]), {kind: 'added', id: 'audiocpp:qwen3_tts_1_7b_base_bf16'});
});

test('行：大小只算权重，配件挂在 uses；整体大小含配件', () => {
  const y = fam('yue2');
  const bf16 = y.pkgs.find((p) => p.id === 'yue2_main_bf16');
  const row = A.rowOf(y, bf16);
  assert.equal(row.id, 'audiocpp:yue2_main_bf16');
  assert.equal(row.cat, 'music');
  assert.deepEqual(row.uses, ['audiocpp:yue2_vae_f16']);
  assert.equal(row.size, Math.round(bf16.mb));
  assert.ok(A.sizeOf(y, bf16) > row.size);
  assert.equal(row.added, 'catalog');
  assert.equal(row.file, null);          // 多个文件的包不写第一个文件名
  assert.equal(row.nfiles, bf16.nfiles);
  assert.equal(row.verified, false);
  assert.equal(row.license.commercialUse, false);
});

test('sync：并进模型表与组件表，就地改；记录拿掉后行与配件一起走，内置行不动', () => {
  const models = [{id: 'yue2-3b', cat: 'music'}];
  const comps = [{id: 'vad'}];
  const entries = [{kind: 'catalog', pkg: 'yue2_main_bf16'}, {kind: 'catalog', pkg: 'yue2_main_q4_0'}];
  const fresh = A.sync(models, comps, C.families, entries);
  assert.deepEqual(fresh, ['audiocpp:yue2_main_bf16', 'audiocpp:yue2_main_q4_0']);
  assert.deepEqual(comps.map((c) => c.id), ['vad', 'audiocpp:yue2_vae_f16']);   // 两只共用一件 VAE
  assert.deepEqual(A.sync(models, comps, C.families, entries), []);              // 再并一次不重复
  A.sync(models, comps, C.families, [entries[0]]);
  assert.deepEqual(models.map((m) => m.id), ['yue2-3b', 'audiocpp:yue2_main_bf16']);
  A.sync(models, comps, C.families, []);
  assert.deepEqual(models.map((m) => m.id), ['yue2-3b']);
  assert.deepEqual(comps.map((c) => c.id), ['vad']);
});

test('sync：内置的包与目录里找不到的记录都跳过', () => {
  const models = [];
  A.sync(models, [], C.families, [{kind: 'catalog', pkg: 'yue2_main_q8_0'}, {kind: 'catalog', pkg: 'gone'}]);
  assert.deepEqual(models, []);
});

test('记录：同一个包不重复加；按行 id 去掉', () => {
  let es = A.addEntry([], {kind: 'catalog', pkg: 'vibevoice_7b_q8_0'});
  es = A.addEntry(es, {kind: 'catalog', pkg: 'vibevoice_7b_q8_0'});
  assert.equal(es.length, 1);
  const custom = {kind: 'custom', fam: 'qwen3_tts', src: 'hf', repo: 'me/my-voice', revision: 'main', path: 'a/b.gguf', mb: 900};
  es = A.addEntry(es, custom);
  assert.equal(es.length, 2);
  es = A.removeEntry(es, C.families, 'audiocpp:vibevoice_7b_q8_0');
  assert.deepEqual(es, [custom]);
  es = A.removeEntry(es, C.families, 'audiocpp-custom:me/my-voice/a/b.gguf');
  assert.deepEqual(es, []);
});

test('认 Hugging Face 文件地址', () => {
  assert.deepEqual(A.parseHfFile('https://huggingface.co/me/repo/blob/abc123/sub/x-q8.gguf?download=true'),
    {ok: true, repo: 'me/repo', revision: 'abc123', path: 'sub/x-q8.gguf'});
  assert.deepEqual(A.parseHfFile('https://hf.co/me/repo/resolve/main/x.gguf'), {ok: true, repo: 'me/repo', revision: 'main', path: 'x.gguf'});
  assert.deepEqual(A.parseHfFile(' me/repo/x.GGUF '), {ok: true, repo: 'me/repo', revision: 'main', path: 'x.GGUF'});
  assert.equal(A.parseHfFile('').code, 'empty');
  assert.equal(A.parseHfFile('https://example.com/me/repo/x.gguf').code, 'not-hf');
  assert.equal(A.parseHfFile('https://huggingface.co/me/repo').code, 'not-hf');
  assert.equal(A.parseHfFile('me/repo/model.safetensors').code, 'not-gguf');
});

test('自己指定：仓库文件要下载，本机文件加完就装好；只列能添加的族', () => {
  const q = fam('qwen3_tts');
  const hf = A.customRow(q, {src: 'hf', repo: 'me/repo', path: 'x/my-voice-q8.gguf', mb: 1200.4});
  assert.equal(hf.name, 'my-voice-q8');
  assert.equal(hf.installed, false);
  assert.equal(hf.cat, 'tts');
  assert.equal(hf.revision, 'main');
  const local = A.customRow(q, {src: 'local', path: '/Users/me/Downloads/v.gguf', mb: 10, name: '我的声音'});
  assert.equal(local.installed, true);
  assert.equal(local.name, '我的声音');
  assert.ok(A.customFamilies(C.families).every((f) => A.groupOf(f) !== 'idle'));
});

test('搜索与计数：按组筛，能加的在前；内置全占的族排后面', () => {
  const all = A.search(C.families, [], '', 'music');
  assert.equal(all.length, A.countOf(C.families, 'music'));
  assert.ok(A.search(C.families, [], 'qwen3', 'tts').some((f) => f.f === 'qwen3_tts'));
  assert.equal(A.search(C.families, [], 'zzzz-none', 'tts').length, 0);
  const states = A.search(C.families, [], '', 'tts').map((f) => A.familyState(f, []));
  assert.deepEqual(states, [...states].sort((a, b) => ({open: 0, nopkg: 1, done: 2}[a] - {open: 0, nopkg: 1, done: 2}[b])));
  assert.ok(A.moreCount(C.families, 'tts') > 40);
  assert.ok(A.moreCount(C.families, 'tts') < A.countOf(C.families, 'tts'));   // Qwen3-TTS 等内置的族不算「另外」
});
