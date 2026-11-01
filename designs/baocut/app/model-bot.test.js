const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-home-workspace.js');
require('./model-bot.js');
const B = global.window.BC_BOT;

const NOW = Date.parse('2026-10-31T12:00:00Z');
const item = (id, patch) => ({id, channelId: 'c', title: id, owner: 'agent', priority: 'medium', updatedAt: NOW, steps: [], finishedSteps: [], outputs: [], updates: [], ...patch});

test('状态键：进行中按子状态，已解决按结局，每个键都在对照表里', () => {
  assert.equal(B.statusKey(item('a', {status: 'active', active: {state: 'needsInput'}})), 'needsInput');
  assert.equal(B.statusKey(item('a', {status: 'active'})), 'working');
  assert.equal(B.statusKey(item('a', {status: 'resolved', resolution: {kind: 'dismissed', at: NOW}})), 'dismissed');
  assert.equal(B.statusKey(item('a', {status: 'scheduled'})), 'scheduled');
  const {items} = B.demo(NOW);
  items.forEach(i => assert.ok(B.STATUS[B.statusKey(i)], i.id));
});

test('任务面板：进行中按子状态分组，空组不列；接下来与定时分开，定时按开始时刻；建议最多 3 条', () => {
  const items = [
    item('w', {status: 'active', active: {state: 'working'}}),
    item('in', {status: 'active', active: {state: 'needsInput'}}),
    item('rv', {status: 'active', active: {state: 'needsReview'}}),
    item('rv2', {status: 'active', active: {state: 'needsReview'}, priority: 'high'}),
    item('bl', {status: 'active', active: {state: 'blocked'}}),
    item('sc2', {status: 'scheduled', startAt: NOW + 2000}),
    item('sc', {status: 'scheduled', startAt: NOW + 1000}),
    item('up', {status: 'upNext'}),
    ...[1, 2, 3, 4].map(n => item('s' + n, {status: 'suggested'})),
  ];
  const s = B.taskSections(items, 'all', NOW, false);
  assert.deepEqual(s.active.map(g => [g.state, g.items.map(i => i.id)]),
    [['needsReview', ['rv2', 'rv']], ['needsInput', ['in']], ['blocked', ['bl']], ['working', ['w']]]);
  assert.deepEqual(s.upNext.map(i => i.id), ['up']);
  assert.deepEqual(s.scheduled.map(i => i.id), ['sc', 'sc2']);
  assert.equal(s.suggested.length, 3);
  assert.deepEqual(B.tabCounts(s), {active: 5, upNext: 1, scheduled: 2, resolved: 0});
});

test('页签：每条任务按状态落到一个页签，建议不落', () => {
  assert.deepEqual(B.TASK_TABS, ['active', 'upNext', 'scheduled', 'resolved']);
  assert.equal(B.tabOf(item('a', {status: 'scheduled'})), 'scheduled');
  assert.equal(B.tabOf(item('a', {status: 'resolved'})), 'resolved');
  assert.equal(B.tabOf(item('a', {status: 'suggested'})), null);
  B.TASK_TABS.forEach(k => assert.ok(B.TAB_LABEL[k], k));
});

test('默认页签：第一个有任务的页签，都空时是进行中', () => {
  const tab = list => B.defaultTab(B.taskSections(list, 'all', NOW, false));
  assert.equal(tab([]), 'active');
  assert.equal(tab([item('s', {status: 'suggested'})]), 'active');
  assert.equal(tab([item('up', {status: 'upNext'}), item('w', {status: 'active', active: {state: 'working'}})]), 'active');
  assert.equal(tab([item('sc', {status: 'scheduled', startAt: NOW + 1000})]), 'scheduled');
  assert.equal(tab([item('d', {status: 'resolved', resolution: {kind: 'done', at: NOW - 1000}})]), 'resolved');
});

test('任务面板：已完成只列 30 天内最近 20 条，其余计数；展开后全列', () => {
  const old = item('old', {status: 'resolved', resolution: {kind: 'done', at: NOW - 40 * 86400000}});
  const recent = Array.from({length: 22}, (_, n) => item('r' + n, {status: 'resolved', resolution: {kind: 'done', at: NOW - n * 1000}}));
  const s = B.taskSections([old, ...recent], 'all', NOW, false);
  assert.equal(s.done.length, 20);
  assert.equal(s.moreDone, 3);
  assert.equal(B.taskSections([old, ...recent], 'all', NOW, true).done.length, 23);
});

test('筛选：我的只看我来做的，智能体的只看交给智能体的', () => {
  const items = [item('u', {status: 'upNext', owner: 'user'}), item('a', {status: 'upNext', owner: 'agent'})];
  assert.deepEqual(B.taskSections(items, 'mine', NOW).upNext.map(i => i.id), ['u']);
  assert.deepEqual(B.taskSections(items, 'agent', NOW).upNext.map(i => i.id), ['a']);
});

test('频道侧栏：主频道一行，没分组的挂在它下面，分组各成一段；段内置顶在前、其余按最近活动；徽标数等你的任务', () => {
  const {channels, groups, items} = B.demo(NOW);
  const rows = B.channelSummaries(channels, items);
  const tree = B.channelTree(rows, groups, 'active');
  const ids = list => list.map(r => r.channel.id);
  assert.equal(tree.main.channel.id, 'chan_main');
  assert.deepEqual(ids(tree.loose), ['chan_shorts']);
  assert.deepEqual(tree.groups.map(g => [g.group.id, ids(g.rows)]), [['grp_tutorials', ['chan_weekly', 'chan_dub']]]);
  assert.equal(rows.find(r => r.channel.id === 'chan_main').counts.needsYou, 2);
  assert.equal(B.needsYouTotal(rows), 3);
});

test('频道侧栏按状态筛：进行中与全部时空分组也列，只看已归档时空分组不列；分组不在了的频道算没分组', () => {
  const row = (id, patch) => ({channel: {id, kind: 'custom', name: id, lastActivityAt: NOW, ...patch}, unread: false, counts: {needsYou: 0}});
  const rows = [
    {channel: {id: 'chan_main', kind: 'main', name: '综合', lastActivityAt: NOW}, unread: false, counts: {needsYou: 0}},
    row('a', {groupId: 'g1'}),
    row('b', {groupId: 'g1', archived: true}),
    row('c', {archived: true}),
    row('d', {groupId: 'gone'}),
  ];
  const groups = [{id: 'g1', name: '一'}, {id: 'g2', name: '空的'}];
  const shape = status => {
    const t = B.channelTree(rows, groups, status);
    return {loose: t.loose.map(r => r.channel.id), groups: t.groups.map(g => [g.group.id, g.rows.map(r => r.channel.id)])};
  };
  assert.deepEqual(shape('active'), {loose: ['d'], groups: [['g1', ['a']], ['g2', []]]});
  assert.deepEqual(shape('archived'), {loose: ['c'], groups: [['g1', ['b']]]});
  assert.deepEqual(shape('all').groups, [['g1', ['a', 'b']], ['g2', []]]);
  assert.equal(B.channelTree(rows, groups, 'archived').main.channel.id, 'chan_main');
  B.CHANNEL_STATUS.forEach(k => assert.ok(B.CHANNEL_STATUS_LABEL[k], k));
});

test('频道图标：主频道固定 Layers；没选过的用对话气泡与按 id 取的颜色，每次一样；选了没有的值也退回缺省', () => {
  assert.deepEqual(B.channelLook({id: 'chan_main', kind: 'main'}), {icon: 'Layers', color: null});
  const look = B.channelLook({id: 'chan_x', kind: 'custom'});
  assert.equal(look.icon, B.DEFAULT_CHANNEL_ICON);
  assert.ok(B.CHANNEL_COLORS.includes(look.color));
  assert.deepEqual(B.channelLook({id: 'chan_x', kind: 'custom'}), look);
  assert.deepEqual(B.channelLook({id: 'chan_x', kind: 'custom', icon: 'Heart', color: 'red'}), {icon: 'Heart', color: 'red'});
  assert.deepEqual(B.channelLook({id: 'chan_x', kind: 'custom', icon: 'Nope', color: 'teal'}), look);
  assert.equal(B.CHANNEL_ICONS.length, 24);
  assert.equal(new Set(B.CHANNEL_ICONS).size, 24);
  assert.ok(!B.CHANNEL_ICONS.includes('Layers'));
  B.CHANNEL_ICONS.forEach(k => assert.ok(B.CHANNEL_ICON_LABEL[k], k));
  B.CHANNEL_COLORS.forEach(k => assert.ok(B.CHANNEL_COLOR_LABEL[k], k));
});

test('频道与分组的名字：必填、最多 40 字，前后空白不算', () => {
  assert.equal(B.nameError('  ', '频道'), '给频道起个名字');
  assert.equal(B.nameError('x'.repeat(41), '频道'), '最多 40 个字');
  assert.equal(B.nameError(` ${'x'.repeat(40)} `, '分组'), null);
});

test('归档与删除确认框里的数：建议不算；归档数没解决的与其中定时的，删除数进行中的智能体任务、全部任务与定时', () => {
  const items = [
    item('w', {status: 'active', active: {state: 'working'}}),
    item('r', {status: 'active', active: {state: 'needsReview'}}),
    item('u', {status: 'upNext', owner: 'user'}),
    item('s', {status: 'scheduled'}),
    item('d', {status: 'resolved', resolution: {kind: 'done', at: NOW}}),
    item('g', {status: 'suggested'}),
    item('x', {channelId: 'other', status: 'active', active: {state: 'working'}}),
  ];
  assert.deepEqual(B.archiveImpact(items, 'c'), {open: 4, scheduled: 1});
  assert.deepEqual(B.deleteImpact(items, 'c'), {working: 1, tasks: 5, scheduled: 1});
});

test('新建任务：默认我来做、进接下来；交给智能体并现在开始才直接开始', () => {
  const t = B.newTask({id: 'n', channelId: 'c', title: '  写提纲 ', ...B.NEW_TASK_DEFAULTS}, NOW);
  assert.equal(t.title, '写提纲');
  assert.equal(t.status, 'upNext');
  assert.equal(B.newTask({id: 'n', channelId: 'c', title: 'x', owner: 'user', start: true}, NOW).status, 'upNext');
  assert.equal(B.newTask({id: 'n', channelId: 'c', title: 'x', owner: 'agent', start: true}, NOW).status, 'active');
});

test('快捷操作与下一步一行', () => {
  assert.deepEqual(B.quickActions(item('a', {status: 'upNext'})), ['start', 'markDone', 'dismiss']);
  assert.deepEqual(B.quickActions(item('a', {status: 'active', active: {state: 'blocked'}})), ['refresh', 'markDone', 'dismiss']);
  assert.equal(B.applyAction(item('a', {status: 'upNext'}), 'markDone', NOW).resolution.kind, 'done');
  assert.equal(B.nextLine(item('a', {status: 'active', question: {text: '用哪张？', options: []}})), '用哪张？');
  assert.equal(B.nextLine(item('a', {status: 'resolved', outcome: '好了'})), '好了');
});

test('提示芯片只跟最后一条消息走：之后用户说了话就收起', () => {
  const chips = [{label: '好'}];
  assert.deepEqual(B.openChips([{kind: 'message', role: 'assistant', text: 'x', chips}, {kind: 'work-item-ref', workItemId: 'a'}]), chips);
  assert.equal(B.openChips([{kind: 'message', role: 'assistant', text: 'x', chips}, {kind: 'message', role: 'user', text: 'y'}]), null);
});

test('Make 面板：建议每个频道取前 3 条；产物分今天与更早，跟着范围走、不含归档频道', () => {
  const out = (kind, at) => ({kind, label: kind, at});
  const items = [
    ...[1, 2, 3, 4].map(n => item('s' + n, {status: 'suggested', updatedAt: NOW - n})),
    item('o', {channelId: 'other', status: 'suggested'}),
    item('a', {status: 'active', outputs: [out('video', NOW - 60000), out('doc', NOW - 2 * 86400000)]}),
    item('b', {channelId: 'other', status: 'resolved', outputs: [out('image', NOW - 1000)]}),
    item('c', {channelId: 'old', status: 'resolved', outputs: [out('video', NOW - 1000)]}),
    item('d', {status: 'resolved', updatedAt: NOW - 3 * 86400000, outputs: [{kind: 'subtitle', label: '没写时间'}]}),
  ];
  const mine = B.makeGallery(items, 'c', 'channel', NOW, ['old']);
  assert.deepEqual(mine.suggestions.map(i => i.id), ['s1', 's2', 's3']);
  assert.deepEqual(mine.today.map(o => o.kind), ['video']);
  assert.deepEqual(mine.earlier.map(o => [o.kind, o.item.id]), [['doc', 'a'], ['subtitle', 'd']]);
  const all = B.makeGallery(items, 'c', 'all', NOW, ['old']);
  assert.deepEqual(all.suggestions.map(i => i.id).sort(), ['o', 's1', 's2', 's3']);
  assert.deepEqual(all.today.map(o => o.item.id), ['b', 'a']);
  Object.keys(B.OUTPUT_KIND).forEach(k => assert.ok(B.OUTPUT_KIND[k].icon && B.OUTPUT_KIND[k].label, k));
});

test('Make 模板：下一次在未来，建出来的是交给智能体的定时任务', () => {
  B.MAKE_TEMPLATES.forEach(t => {
    const next = t.next(NOW);
    assert.ok(next > NOW && next - NOW <= 32 * 86400000, t.id);
    const task = B.taskFromTemplate({id: 'x', channelId: 'c', template: t}, NOW);
    assert.equal(task.status, 'scheduled');
    assert.equal(task.owner, 'agent');
    assert.equal(task.startAt, next);
    assert.equal(B.tabOf(task), 'scheduled');
  });
  const monday = B.MAKE_TEMPLATES.find(t => t.id === 'transcribe').next(NOW);
  assert.equal(new Date(monday).getDay(), 1);
  assert.equal(new Date(monday).getHours(), 9);
});

test('频道设置：没写的项跟随默认', () => {
  assert.deepEqual(B.channelSettings({id: 'c'}), B.CHANNEL_SETTINGS);
  const s = B.channelSettings({id: 'c', settings: {concurrentThreads: 5, currency: 'CNY'}});
  assert.equal(s.concurrentThreads, 5);
  assert.equal(s.currency, 'CNY');
  assert.equal(s.driverId, null);
});

test('记忆用量：按 UTF-8 字节算，九成以上快满，超过上限不能保存', () => {
  const ascii = B.memoryUsage('abc', 'channel');
  assert.equal(ascii.bytes, 3);
  assert.equal(ascii.limit, 16 * 1024);
  assert.equal(B.memoryUsage('中', 'user').bytes, 3);
  assert.equal(B.memoryUsage('', 'user').limit, 8 * 1024);
  const near = B.memoryUsage('a'.repeat(7400), 'user');
  assert.ok(near.near && !near.over);
  assert.match(near.label, /快满了/);
  const over = B.memoryUsage('a'.repeat(8193), 'user');
  assert.ok(over.over && !over.near);
  assert.match(over.label, /^8\.0 KB \/ 8\.0 KB · 太长/);
});

test('右栏宽度：各形态的默认宽，拖过的夹在范围里', () => {
  assert.equal(B.sideWidth('tasks', null, 1200).width, 340);
  assert.equal(B.sideWidth('make', null, 1200).width, 380);
  assert.equal(B.sideWidth('detail', null, 1200).width, 540);
  assert.equal(B.sideWidth('detail', null, 2000).width, 640);
  assert.ok(B.sideWidth('detail', null, 1200).width > B.sideWidth('tasks', null, 1200).width);
  assert.equal(B.sideWidth('output', null, 1200).width, 760);
  assert.equal(B.sideWidth('tasks', 100, 1200).width, B.SIDE_MIN);
  const wide = B.sideWidth('tasks', 5000, 1200);
  assert.equal(wide.width, 1200 - B.CENTER_MIN);
  assert.equal(wide.max, 1200 - B.CENTER_MIN);
  assert.equal(B.sideWidth('output', null, 600).width, B.SIDE_MIN);
});

test('右栏页签：路由开任务与产物页签，按频道与收件箱各记一份，回到固定页签时已开的留着', () => {
  let book = {};
  book = B.reconcileSideTabs(book, {id: 'c1', task: 'wi_a'});
  assert.deepEqual(book.c1, {tabs: [{key: 'task:wi_a', kind: 'task', task: 'wi_a'}], active: 'task:wi_a'});
  book = B.reconcileSideTabs(book, {id: 'c1', task: 'wi_a', out: '1'});
  assert.deepEqual(book.c1.tabs.map(t => t.key), ['task:wi_a', 'out:wi_a:1']);
  assert.equal(book.c1.active, 'out:wi_a:1');
  const same = B.reconcileSideTabs(book, {id: 'c1', task: 'wi_a', out: '1'});
  assert.equal(same, book);
  book = B.reconcileSideTabs(book, {id: 'c1'});
  assert.equal(book.c1.active, null);
  assert.equal(book.c1.tabs.length, 2);
  book = B.reconcileSideTabs(book, {view: 'inbox', id: 'c1', task: 'wi_b'});
  assert.deepEqual(book.inbox.tabs.map(t => t.key), ['task:wi_b']);
  assert.equal(book.c1.tabs.length, 2);
  assert.equal(B.sideTabBook({}), 'chan_main');
  assert.equal(B.reconcileSideTabs({}, {id: 'c2'}).c2.active, null);
  assert.equal(B.sideTabFromRoute({task: 'wi_a', out: 'x'}).kind, 'task');
  for (const tab of book.c1.tabs) assert.deepEqual(B.sideTabFromRoute({id: 'c1', ...B.sideTabRoute(tab)}), tab);
  assert.deepEqual(B.sideTabRoute(null), {task: null, out: null});
});

test('关页签：关当前的选右边那个，最后一个选左边，关光了回到固定页签', () => {
  const s = {tabs: ['a', 'b', 'c'].map(key => ({key})), active: 'b'};
  assert.equal(B.closeSideTab(s, 'b').active, 'c');
  assert.equal(B.closeSideTab({...s, active: 'c'}, 'c').active, 'b');
  assert.equal(B.closeSideTab(s, 'a').active, 'b');
  assert.equal(B.closeSideTab({tabs: [{key: 'a'}], active: 'a'}, 'a').active, null);
});

test('固定页签：按「任务」「Make」的顺序插回，关掉正选着的选右边、再左边，关光了是 null', () => {
  assert.deepEqual(B.openFixedTab(['make'], 'tasks'), ['tasks', 'make']);
  assert.deepEqual(B.openFixedTab([], 'make'), ['make']);
  assert.deepEqual(B.openFixedTab(['tasks', 'make'], 'make'), ['tasks', 'make']);
  const tabs = [{key: 'task:a'}, {key: 'out:a:0'}];
  assert.equal(B.afterFixedClose(['tasks', 'make'], 'tasks', tabs), 'fixed:make');
  assert.equal(B.afterFixedClose(['tasks', 'make'], 'make', tabs), 'task:a');
  assert.equal(B.afterFixedClose(['tasks', 'make'], 'make', []), 'fixed:tasks');
  assert.equal(B.afterFixedClose(['make'], 'make', []), null);
  assert.equal(B.afterFixedClose(['tasks'], 'make', tabs), null);
});

test('占满：左边是当前页签的上一层，右边是当前页签；左栏宽夹在范围里', () => {
  const out = {key: 'out:t:0', kind: 'output', task: 't', index: 0};
  const task = {key: 'task:t', kind: 'task', task: 't'};
  assert.deepEqual(B.fullColumns(out, 'tasks', false), {left: {kind: 'task', task: 't'}, right: out});
  assert.deepEqual(B.fullColumns(task, 'make', false), {left: {kind: 'tasks'}, right: task});
  assert.deepEqual(B.fullColumns(task, 'tasks', true).left, {kind: 'inbox'});
  assert.deepEqual(B.fullColumns(null, 'make', false), {left: {kind: 'make'}, right: null});
  assert.equal(B.sideMode(out, 'tasks'), 'output');
  assert.equal(B.sideMode(task, 'make'), 'detail');
  assert.equal(B.sideMode(null, 'make'), 'make');
  assert.equal(B.fullSplit('task', null, 1400).width, 440);
  assert.equal(B.fullSplit('tasks', 9999, 1400).width, 1400 - B.FULL_RIGHT_MIN);
  assert.equal(B.fullSplit('tasks', 10, 1400).width, B.SIDE_MIN);
});

test('演示产物：视频挂着原型的视频，线程消息指向产物下标', () => {
  const d = B.demo(NOW);
  for (const i of d.items) {
    for (const o of i.outputs) if (o.kind === 'video') assert.ok(o.project, o.label);
    for (const m of i.thread || []) for (const n of m.outputs || []) assert.ok(i.outputs[n], `${i.id} → ${n}`);
  }
  assert.ok(d.memories.chan_main && d.memories.user);
});
