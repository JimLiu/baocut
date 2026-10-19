const test = require('node:test');
const assert = require('node:assert');
global.window = {};
['substyle', 'pose', 'shape-paths', 'elements', 'textpresets', 'wordanim', 'subanim', 'subpresets', 'motioncaption', 'template', 'cut', 'defaultsub']
  .forEach((m) => require(`./model-${m}.js`));
require('./data.js');
require('./model-video-versions.js');
const V = global.window.BC_VIDEO_VERSIONS;
const D = global.window.BC_DATA;
const names = {claude: 'Claude Code'};
const p1 = () => V.normalize(D.videoVersions.p1);

test('摘要与引擎同一套模板', () => {
  assert.equal(V.summarize([]), '编辑');
  assert.equal(V.summarize([{actor: 'user_local', label: '裁切片段', count: 1}]), '裁切片段');
  assert.equal(V.summarize([{actor: 'user_local', label: '裁切片段', count: 4}]), '裁切片段（4 项修改）');
  assert.equal(V.summarize([{actor: 'agent:claude', label: '剪掉片段', count: 3}, {actor: 'user_local', label: '裁切片段', count: 11}, {actor: 'user_local', label: '修改文字', count: 2}]),
    '裁切片段等 16 项修改');
  // 次数相同时取先出现的；只计数的事务也算进总数
  assert.equal(V.summarize([{actor: 'a', label: '甲', count: 2}, {actor: 'b', label: '乙', count: 2}]), '甲等 4 项修改');
  assert.equal(V.summarize([{actor: 'a', label: '甲', count: 1}], 3), '甲等 4 项修改');
});

test('执行者与文件的显示名', () => {
  assert.equal(V.actorLabel('user_local', names), '你');
  assert.equal(V.actorLabel('agent:claude', names), 'Claude Code');
  assert.equal(V.actorLabel('agent:codex', names), 'codex');
  assert.equal(V.actorLabel('system:jobs', names), 'BaoCut');
  assert.equal(V.actorKind('external:drive'), 'external');
  const st = p1();
  assert.equal(V.fileLabel('video.json', st.docs), '时间线');
  assert.equal(V.fileLabel('documents/doc_p1_en.json', st.docs), '英语译文');
  assert.equal(V.fileLabel('documents/doc_x.json', st.docs), '文档');
});

test('演示数据：新的在前，最新一版开着，保留 10 个未命名的加全部保存的', () => {
  const st = p1();
  assert.deepEqual(st.versions.map((v) => v.n), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(st.versions[0].open, true);
  assert.equal(st.versions.filter((v) => v.open).length, 1);
  assert.equal(st.versions.filter((v) => v.kind !== 'save').length, 10);
  // 回到版本 8 的那一版结束时就是版本 8 结束时的状态；保存的版本 diff 为空
  assert.equal(V.find(st, 10).to, V.find(st, 8).to);
  assert.equal(V.find(st, 13).from, V.find(st, 13).to);
  assert.equal(st.current, V.find(st, 14).to);
  const rows = V.rows(st, names);
  assert.equal(rows[0].title, '裁切片段等 16 项修改');
  assert.equal(rows[1].title, '发给周远审的版本');
  assert.equal(rows[4].title, '回到版本 8');
  assert.match(rows[0].sub, /^1 分钟前 · Claude Code、你$/);
});

test('时间段：同一天写一段钟点，同一分钟只写一个，跨天两头写日子', () => {
  const st = p1();
  assert.equal(V.rangeText(V.find(st, 14)), '今天 10:12–10:29');
  assert.equal(V.rangeText(V.find(st, 13)), '今天 09:32');
  assert.equal(V.rangeText(V.find(st, 4)), '昨天 13:00–13:40');
  assert.equal(V.rangeText(V.find(st, 2)), '10月14日 10:20');
  assert.equal(V.rangeText({start: 640, end: 600}), '昨天 23:50 – 今天 00:30');
});

test('详情：顶上那一版不给「回到这个版本」；动作按执行者分组', () => {
  const st = p1();
  const top = V.detail(st, 14, names);
  assert.equal(top.restoreEnd, null);
  assert.equal(top.restoreBefore.ok, true);
  assert.deepEqual(top.actors.map((g) => [g.label, g.items.length]), [['Claude Code', 1], ['你', 2]]);
  assert.deepEqual(top.files.map((f) => f.label), ['时间线', '英语译文']);
  const save = V.detail(st, 13, names);
  assert.equal(save.canDelete, true);
  assert.equal(save.note, '第 1–2 章定稿；第 3 章还要压停顿。');
  assert.equal(V.detail(st, 12, names).canDelete, false);
});

test('保存版本：名字必填；之前开着的那一版收口，新的一版 diff 为空', () => {
  const st = p1();
  assert.equal(V.save(st, {name: '  '}).error.code, 'INVALID_INPUT');
  const r = V.save(st, {name: '给周远', note: ''});
  assert.equal(r.version, 15);
  assert.equal(r.state.versions[0].kind, 'save');
  assert.equal(r.state.versions[0].note, null);
  assert.equal(r.state.versions[1].open, false);
  assert.equal(r.state.revision, st.revision + 1);
  assert.equal(r.state.current, st.current);
  assert.deepEqual(V.diffOf(r.state, r.state.versions[0]), []);
});

test('回到版本：成一个 restore 版本；再回到同一个状态不提交、不产生版本', () => {
  const st = p1();
  const r = V.restore(st, 11, false);
  assert.equal(r.version, 15);
  const v = r.state.versions[0];
  assert.equal(v.kind, 'restore');
  assert.equal(V.summaryOf(v), '回到版本 11');
  assert.equal(r.state.current, V.find(st, 11).to);
  // 保留规则：未命名的超出 10 个，最旧的一段（版本 3）并进紧接着的版本 4
  assert.equal(V.find(r.state, 3), null);
  assert.equal(V.find(r.state, 4).start, V.find(st, 3).start);
  assert.deepEqual(V.find(r.state, 4).actions.map((a) => a.label), ['写入文档', '剪掉片段']);
  const again = V.restore(r.state, 11, false);
  assert.equal(again.noop, true);
  assert.equal(again.state.versions.length, r.state.versions.length);
  // 「回到版本 14 之前」就是版本 13（保存的，diff 为空）结束时，也是版本 12 结束时
  assert.equal(V.targetOf(st, 14, true), V.targetOf(st, 12, false));
  assert.equal(V.detail(r.state, 11, names).restoreEnd.noop, true);
});

test('删除保存的版本：别的种类拒绝；最新一版变回开着的一段；中间的并进紧接着的那一版', () => {
  const st = p1();
  assert.equal(V.remove(st, 12).error.code, 'INVALID_OPERATION');
  const mid = V.remove(st, 13);
  assert.equal(V.find(mid.state, 13), null);
  const v14 = V.find(mid.state, 14);
  assert.equal(v14.from, V.find(st, 12).to);
  assert.equal(v14.actions[0].label, '保存版本');
  assert.equal(v14.actions[v14.actions.length - 1].label, '删除保存的版本');
  const saved = V.save(st, {name: '临时'}).state;
  const top = V.remove(saved, 15);
  assert.equal(top.state.versions[0].kind, 'segment');
  assert.equal(top.state.versions[0].open, true);
  assert.equal(top.state.versions[0].name, null);
  assert.equal(V.summaryOf(top.state.versions[0]), '保存版本等 2 项修改');
});

test('读不出的版本：它和更早的回不去，紧接着那一版「之前」还回得去', () => {
  const st = V.scenario(p1(), 'unreadable');
  const bad = st.versions.find((v) => v.unreadable).n;
  const rows = V.rows(st, names);
  assert.equal(rows.find((r) => r.n === bad).unreadable, true);
  assert.equal(V.reach(st, bad, false, false).ok, false);
  assert.equal(V.reach(st, bad + 1, true, false).ok, true);
  assert.equal(V.reach(st, bad - 1, false, false).brokenAt, bad);
  assert.equal(rows.find((r) => r.n === bad - 1).blocked, true);
  assert.equal(rows.find((r) => r.n === bad + 1).blocked, false);
  assert.equal(V.restore(st, bad - 1, false).error.code, 'VERSION_CHAIN_BROKEN');
});

test('被改过的版本：界面事先不知道，回到时才报 VERSION_CHAIN_BROKEN，之后标出断点', () => {
  const st = V.scenario(p1(), 'tampered');
  const k = st.tampered[0];
  assert.equal(V.detail(st, k - 1, names).restoreEnd.ok, true);
  const r = V.restore(st, k - 1, false);
  assert.equal(r.error.code, 'VERSION_CHAIN_BROKEN');
  assert.equal(r.error.brokenAt, k);
  assert.equal(r.state.current, st.current);
  assert.equal(r.state.versions.length, st.versions.length);
  assert.equal(V.detail(r.state, k - 1, names).restoreEnd.ok, false);
  assert.match(V.detail(r.state, k - 1, names).restoreEnd.why, new RegExp(`版本 ${k} 处对不上`));
  // 断点那一版结束时不用逆着走过它，回得去
  assert.equal(V.detail(r.state, k, names).restoreEnd.ok, true);
  assert.equal(V.detail(r.state, k, names).restoreBefore.ok, false);
});

test('快照冲突、不在项目里：写操作都拒绝', () => {
  const c = V.scenario(p1(), 'conflict');
  assert.equal(V.stateOf(c).k, 'conflict');
  assert.equal(V.stateOf(c).label, '快照和 BaoCut 都改过');
  assert.deepEqual(c.changedPaths, ['video.json', 'documents/doc_p1_ja.json']);
  assert.equal(V.save(c, {name: 'x'}).error.code, 'SNAPSHOT_CONFLICT');
  assert.equal(V.restore(c, 12, false).error.code, 'SNAPSHOT_CONFLICT');
  const i = V.scenario(p1(), 'invalid');
  assert.equal(V.stateOf(i).label, '快照读不出');
  assert.match(V.save(i, {name: 'x'}).error.message, /快照读不出/);
  const o = V.scenario(p1(), 'outside');
  assert.equal(V.stateOf(o), null);
  assert.equal(V.save(o, {name: 'x'}).error.code, 'VERSIONS_NEED_PROJECT');
  assert.match(V.buttonTip(o), /不在项目里/);
});

test('重建：拷来的视频末尾是一个重建版本，回到重建前的最后一版不改变内容', () => {
  const st = V.normalize(D.videoVersions.p14);
  assert.equal(st.versions[0].kind, 'rebuild');
  assert.equal(V.summaryOf(st.versions[0]), '从快照重建');
  assert.equal(V.restore(st, 5, false).noop, true);
  assert.equal(V.restore(st, 3, false).version, 7);
  assert.ok(D.projects.find((p) => p.id === 'p14').snapshotOnly);
});

test('diff：标准 unified diff，按文件分，计 +/−', () => {
  const st = p1();
  const files = V.diffOf(st, V.find(st, 14));
  assert.deepEqual(files.map((f) => f.path), ['video.json', 'documents/doc_p1_en.json']);
  assert.ok(files[0].plus > 0 && files[0].minus > 0);
  const text = V.diffText(st, V.find(st, 14));
  assert.match(text, /^--- a\/video\.json\n\+\+\+ b\/video\.json\n@@ -\d+,7 \+\d+,\d+ @@/);
  const added = V.diffText(st, V.find(st, 3));
  assert.match(added, /--- \/dev\/null\n\+\+\+ b\/documents\/doc_p1_en\.json/);
  // 同一版每次生成的一样
  assert.equal(V.diffText(st, V.find(st, 14)), text);
});

test('没写演示历史的视频有一段短历史', () => {
  const st = V.normalize(V.seed({mtime: 10}));
  assert.deepEqual(st.versions.map((v) => v.n), [4, 3, 2, 1]);
  assert.equal(st.versions[0].open, true);
  assert.equal(V.summaryOf(st.versions[0]), '裁切片段等 7 项修改');
});

test('撤销回到版本：一笔新修改，内容回到之前，开一个新的一段', () => {
  const st = p1();
  const r = V.restore(st, 12, false);
  const u = V.undoRestore(r.state, r.version);
  assert.equal(u.current, st.current);
  assert.equal(u.versions[0].kind, 'segment');
  assert.equal(u.versions[0].open, true);
  assert.equal(V.summaryOf(u.versions[0]), '撤销：回到版本 12');
  assert.equal(u.versions[1].kind, 'restore');
});

test('只有快照被改：发现就导入，单独成一个外部变更版本，可以撤销', () => {
  const e = V.scenario(p1(), 'external');
  assert.equal(V.stateOf(e).label, '正在导入外部改动');
  assert.match(V.buttonTip(e), /正在导入外部改动/);
  const r = V.applyExternal(e);
  const v = r.state.versions[0];
  assert.equal(r.version, 15);
  assert.equal(v.kind, 'external');
  assert.equal(V.summaryOf(v), '外部变更');
  assert.deepEqual(v.actions, [{actor: 'system:history', label: '外部变更', count: 1}]);
  assert.deepEqual(v.files.map((f) => f.path), ['video.json', 'documents/doc_p1_ja.json']);
  // diff 从库里导入前的状态算起；之前开着的那一版收口，之后的改动另开一版
  assert.equal(v.from, e.current);
  assert.equal(r.state.current, 'X1');
  assert.equal(r.state.versions[1].open, false);
  assert.equal(r.state.state, 'synced');
  assert.deepEqual(r.state.changedPaths, []);
  assert.equal(V.rows(r.state, names)[0].kindLabel, '外部变更');
  // 回到外部变更之前就是导入前的内容
  assert.equal(V.targetOf(r.state, 15, true), e.current);
  // 已经导入过（或不是 external）时什么也不做
  assert.equal(V.applyExternal(r.state).noop, true);
  // 撤销导入：一笔普通的修改，内容回到导入前，开一个新的一段
  const u = V.undoImport(r.state, 15);
  assert.equal(u.current, e.current);
  assert.equal(u.versions[0].kind, 'segment');
  assert.equal(u.versions[0].open, true);
  assert.equal(V.summaryOf(u.versions[0]), '撤销：外部变更');
});

test('两边都改了，用磁盘上的：库里的改动先封存，外部变更从它结束时算起', () => {
  const c = V.scenario(p1(), 'conflict');
  const ask = V.resolveAsk(c, 'snapshot');
  assert.equal(ask.confirmLabel, '用磁盘上的');
  assert.match(ask.body, /3 项修改（修改文字）先并进版本 14/);
  const r = V.resolve(c, 'snapshot');
  assert.equal(r.sealed, 14);
  assert.equal(r.version, 15);
  const [ext, sealed] = r.state.versions;
  assert.equal(sealed.open, false);
  assert.equal(sealed.to, 'L1');
  // 同一执行者、同一标签合在一起计数：原来的 2 次改字加上还没写进快照的 3 次
  assert.equal(sealed.actions.find((a) => a.label === '修改文字').count, 5);
  assert.equal(ext.kind, 'external');
  assert.equal(ext.from, 'L1');
  assert.equal(r.state.current, 'X1');
  assert.equal(r.state.state, 'synced');
  assert.equal(r.state.conflict, null);
  // 回到外部变更之前，找回库里原来的改动
  assert.equal(V.targetOf(r.state, 15, true), 'L1');
  assert.match(V.resolvedNote(r).text, /原来的修改在版本 14，回到版本 15 之前就能找回/);
  // 最新一版已经收口时，封存开一个新版本
  const closed = Object.assign({}, c, {versions: c.versions.map((v, i) => Object.assign({}, v, {open: i ? v.open : false}))});
  assert.match(V.resolveAsk(closed, 'snapshot').body, /先存成版本 15/);
  const r2 = V.resolve(closed, 'snapshot');
  assert.equal(r2.sealed, 15);
  assert.equal(r2.version, 16);
  assert.equal(r2.state.versions[1].from, 'S14');
});

test('两边都改了，保留 BaoCut 里的：立即覆盖快照，外部改动不进版本记录', () => {
  const c = V.scenario(p1(), 'conflict');
  const ask = V.resolveAsk(c, 'video');
  assert.equal(ask.tone, 'negative');
  assert.match(ask.body, /覆盖磁盘上被改过的 2 个文件（时间线、日语译文）/);
  assert.match(ask.body, /找不回来/);
  const r = V.resolve(c, 'video');
  // 库里的改动照常并进还开着的最新一版
  assert.equal(r.version, 14);
  assert.equal(r.state.versions[0].open, true);
  assert.equal(r.state.versions[0].to, 'L1');
  assert.ok(r.state.versions.every((v) => v.kind !== 'external'));
  assert.equal(r.state.current, 'L1');
  assert.equal(r.state.state, 'synced');
  assert.equal(r.state.snapshotRevision, r.state.revision);
  // 之后照常可以保存版本
  assert.equal(V.save(r.state, {name: '合并后'}).version, 15);
});

test('快照读不出：只能保留 BaoCut 里的', () => {
  const i = V.scenario(p1(), 'invalid');
  const no = V.resolve(i, 'snapshot');
  assert.equal(no.error.code, 'SNAPSHOT_INVALID');
  assert.equal(no.state, i);
  assert.match(V.resolveAsk(i, 'video').body, /覆盖磁盘上读不出的 1 个文件（时间线）/);
  const r = V.resolve(i, 'video');
  // 库里没有别的改动：只写快照，版本记录不变
  assert.equal(r.version, null);
  assert.equal(r.state.versions.length, i.versions.length);
  assert.equal(r.state.state, 'synced');
  assert.equal(V.resolve(r.state, 'video').noop, true);
});
