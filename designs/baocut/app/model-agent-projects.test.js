const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-agent-projects.js');
const P = global.window.BC_AGENT_PROJECTS;

test('内部检查导出不触发会话视频卡，检查文件不算产物', () => {
  const items = [{id: 'v1', kind: 'movie'}, {id: 'sample', session: 's1', status: 'done', purpose: 'preview'}, {id: 'delivery', session: 's1', status: 'done'}];
  const sess = {id: 's1', messages: [{id: 'call', role: 'tool', taskId: 'preview', artifactIds: ['sample', 'v1']}]};
  const tasks = [{id: 'preview', kind: 'export', purpose: 'preview', project: 'v1'}];
  assert.deepEqual(P.artifactList(sess, items, tasks).map(it => it.id), ['delivery']);
  assert.deepEqual(P.artifactList(sess, items, [{...tasks[0], purpose: 'deliverable'}]).map(it => it.id), ['v1', 'delivery']);
});

const dirs = [
  {id: 'd1', name: '科浪访谈', path: '~/BaoCut/科浪访谈/', mtime: 300},
  {id: 'd2', name: '新品发布', path: '~/BaoCut/新品发布', mtime: 900, pinned: true},
  {id: 'd3', name: '空目录', path: '~/BaoCut/空目录/', mtime: 5},
];
const movies = [
  {id: 'm1', title: '双语版', dir: 'd1', folder: '双语版', mtime: 120},
  {id: 'm2', title: '精剪', dir: 'd1', folder: '精剪', mtime: 3},
  {id: 'm3', title: '发布口播', dir: 'd2', folder: '发布口播', mtime: 400},
];
const S = (id, o) => Object.assign({id, title: id, project: null, status: 'idle', ago: 10, messages: []}, o);
const sessions = [
  S('a', {project: 'm1', status: 'running', ago: 4}),
  S('b', {title: '统一译法', project: 'm1', status: 'done', ago: 18, review: true, pinned: true}),
  S('c', {project: 'm3', status: 'waiting', ago: 6}),
  S('d', {dir: 'd2', ago: 50, messages: [{role: 'user', text: 'x'}, {role: 'assistant', text: '', error: 'boom'}]}),
  S('e', {ago: 2, unread: true}),
  S('f', {ago: 700, pinned: true}),
];

test('会话状态：在跑 / 等批准 / 失败 / 待审阅 / 未读；没状态是 null', () => {
  assert.deepEqual(sessions.map(P.sessionStatus), ['running', 'review', 'waiting', 'failed', 'unread', null]);
  assert.equal(P.statusInfo('waiting').label, '等待批准');
  assert.equal(P.statusInfo(null), null);
});

test('失败只看最后一轮：用户又说了话，就不再算失败', () => {
  const s = S('x', {messages: [{role: 'assistant', error: 'boom'}, {role: 'user', text: '再试'}]});
  assert.equal(P.sessionStatus(s), null);
  // 失败之后又有工具行，仍以最后一条回复为准
  const t = S('y', {messages: [{role: 'assistant', error: 'boom'}, {role: 'tool', cmd: 'x'}]});
  assert.equal(P.sessionStatus(t), 'failed');
});

test('会话归属：视频的目录优先，其次会话自己的 dir', () => {
  assert.equal(P.dirOf(sessions[0], movies), 'd1');
  assert.equal(P.dirOf(sessions[3], movies), 'd2');
  assert.equal(P.dirOf(sessions[4], movies), null);
  assert.equal(P.dirOf(S('z', {project: 'gone', dir: 'd3'}), movies), 'd3');
});

test('视频路径 = 项目目录 + 子目录，项目路径有没有尾斜杠都行', () => {
  assert.equal(P.moviePath(dirs[0], movies[0]), '~/BaoCut/科浪访谈/双语版/');
  assert.equal(P.moviePath(dirs[1], movies[2]), '~/BaoCut/新品发布/发布口播/');
  assert.equal(P.moviePath(null, movies[0]), '');
});

test('项目树：按最近活动排，会话挂在各自项目下，其余进「最近」', () => {
  const t = P.tree({dirs, movies, sessions});
  assert.deepEqual(t.projects.map((p) => p.dir.id), ['d1', 'd3', 'd2']);
  assert.deepEqual(t.projects[0].sessions.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(t.projects[0].movies.map((m) => m.id), ['m1', 'm2']);
  assert.equal(t.projects[0].ago, 3, '视频 m2 三分钟前改过，比会话还近');
  assert.deepEqual(t.projects[2].sessions.map((s) => s.id), ['c', 'd']);
  assert.deepEqual(t.loose.map((s) => s.id), ['e', 'f']);
  assert.deepEqual(t.projects[1].sessions, []);
});

test('项目行的汇总：按急迫度排，带数；一行字', () => {
  const t = P.tree({dirs, movies, sessions});
  const d2 = t.projects.find((p) => p.dir.id === 'd2');
  assert.deepEqual(d2.summary.map((x) => [x.k, x.n]), [['waiting', 1], ['failed', 1]]);
  assert.equal(P.summaryText(d2.summary), '1 等待批准 · 1 失败');
  assert.equal(P.summaryText(P.summarize([sessions[5]])), '');
});

test('置顶：先项目，再会话（按最近活动）', () => {
  const t = P.tree({dirs, movies, sessions});
  assert.deepEqual(t.pinned.map((x) => x.kind + ':' + x.id), ['dir:d2', 'session:b', 'session:f']);
});

test('不认识的目录不吞会话：落回「最近」', () => {
  const t = P.tree({dirs, movies, sessions: [S('q', {dir: 'nope'})]});
  assert.deepEqual(t.loose.map((s) => s.id), ['q']);
});

test('通知：只列要你处理的（不含进行中），按急迫度', () => {
  assert.deepEqual(P.attention(sessions).map((x) => x.sess.id + ':' + x.status.k),
    ['c:waiting', 'd:failed', 'b:review', 'e:unread']);
});

test('搜索：命中项目名 / 路径 / 视频名留整个项目；否则只留标题命中的会话', () => {
  const t = P.tree({dirs, movies, sessions});
  const a = P.search(t, '发布');
  assert.deepEqual(a.projects.map((p) => p.dir.id), ['d2']);
  assert.equal(a.projects[0].sessions.length, 2);
  const b = P.search(t, '译法');
  assert.deepEqual(b.projects.map((p) => [p.dir.id, p.sessions.map((s) => s.id)]), [['d1', ['b']]]);
  assert.deepEqual(b.pinned.map((x) => x.id), ['b']);
  assert.equal(P.search(t, '  '), t);
});

test('打开视频时左侧的会话：自己的最近一条 → 同项目里还没选视频的 → 空', () => {
  assert.deepEqual(P.sessionForMovie('m1', movies, sessions), {sid: 'a', bind: false});
  assert.deepEqual(P.sessionForMovie('m3', movies, sessions), {sid: 'c', bind: false});
  // m2 没有自己的会话；d1 里也没有还没选视频的会话 —— 不借 m1 的
  assert.deepEqual(P.sessionForMovie('m2', movies, sessions), {sid: null, bind: false});
  const more = sessions.concat([S('g', {dir: 'd1', ago: 1})]);
  assert.deepEqual(P.sessionForMovie('m2', movies, more), {sid: 'g', bind: true});
});

test('会话能不能留在这部视频左侧', () => {
  assert.ok(P.fitsMovie(sessions[0], 'm1', movies));
  assert.ok(!P.fitsMovie(sessions[0], 'm2', movies), '同项目但写入目标是另一部');
  assert.ok(P.fitsMovie(sessions[3], 'm3', movies), '同项目、还没选视频');
  assert.ok(!P.fitsMovie(sessions[4], 'm1', movies));
  assert.ok(!P.fitsMovie(null, 'm1', movies));
});

test('同一个项目的会话（抽屉切换菜单）', () => {
  assert.deepEqual(P.sessionsOfMovieProject('m2', movies, sessions).map((s) => s.id), ['a', 'b']);
  assert.deepEqual(P.sessionsOfMovieProject('m3', movies, sessions).map((s) => s.id), ['c', 'd']);
  assert.deepEqual(P.sessionsOfMovieProject('loose', [{id: 'loose'}], [S('k', {project: 'loose'})]).map((s) => s.id), ['k']);
});

test('新建项目：落在 ~/BaoCut/ 下，缺省叫「未命名项目」，重名或撞路径就加序号', () => {
  const a = P.newDir(dirs, 'n1');
  assert.deepEqual(a, {id: 'n1', name: '未命名项目', path: '~/BaoCut/未命名项目/', mtime: 0});
  const b = P.newDir([a].concat(dirs), 'n2');
  assert.equal(b.name, '未命名项目 2');
  assert.equal(b.path, '~/BaoCut/未命名项目-2/');
  assert.equal(P.newDir([a, b], 'n3').name, '未命名项目 3');
  // 名字不同但路径会撞（目录里已经有「未命名项目」这个文件夹）也算占用
  assert.equal(P.newDir([{id: 'x', name: '别的名字', path: '~/BaoCut/未命名项目'}], 'n4').name, '未命名项目 2');
  // 自带名字：空白与间隔号进路径时换成 -
  assert.deepEqual(P.newDir(dirs, 'n5', '  访谈 · 第 3 期 '), {id: 'n5', name: '访谈 · 第 3 期', path: '~/BaoCut/访谈-第-3-期/', mtime: 0});
  assert.equal(P.newDir(dirs, 'n6', '科浪访谈').name, '科浪访谈 2');
  assert.equal(P.dirPath('a/b'), '~/BaoCut/a-b/');
});

test('新建的项目排在项目树最上面，还没有会话', () => {
  const nd = P.newDir(dirs, 'n1');
  const t = P.tree({dirs: [nd].concat(dirs), movies, sessions});
  assert.equal(t.projects[0].dir.id, 'n1');
  assert.deepEqual(t.projects[0].sessions, []);
  assert.deepEqual(t.projects[0].movies, []);
  assert.equal(t.projects[0].ago, 0);
});

test('打开已有目录：路径照原样（补尾斜杠），名字取最后一段；同一路径不接第二次', () => {
  const r = P.openDir(dirs, 'o1', P.DEMO_OPEN_DIR);
  assert.equal(r.added, true);
  assert.deepEqual(r.dir, {id: 'o1', name: P.DEMO_OPEN_DIR.name, path: P.DEMO_OPEN_DIR.path, mtime: 0});
  assert.ok(!P.DEMO_OPEN_DIR.path.startsWith(P.DIR_ROOT), '演示的是 ~/BaoCut/ 之外的已有目录');
  const again = P.openDir([r.dir].concat(dirs), 'o2', P.DEMO_OPEN_DIR);
  assert.deepEqual([again.added, again.dir.id], [false, 'o1']);
  assert.deepEqual(P.openDir(dirs, 'o3', {path: '~/Movies/家里的录像'}).dir,
    {id: 'o3', name: '家里的录像', path: '~/Movies/家里的录像/', mtime: 0});
  // 已经在列表里的项目（d2 的路径没写尾斜杠）也认得出来
  assert.deepEqual(P.openDir(dirs, 'o4', {path: '~/BaoCut/新品发布/'}), {dir: dirs[1], added: false});
  assert.equal(P.openDir(dirs, 'o5', {path: ''}), null);
  assert.equal(P.openDir(dirs, 'o6', null), null);
});


test('sidebar organization preserves ownership and returns each session once in the flat view', () => {
  const t = P.tree({dirs, movies, sessions});
  const before = JSON.stringify(t);
  const recent = P.sidebarView(t);
  assert.deepEqual(recent.flat.map((s) => s.id), ['e', 'a', 'c', 'b', 'd', 'f']);
  assert.equal(new Set(recent.flat.map((s) => s.id)).size, sessions.length);
  const named = P.sidebarView(t, {sort: 'name'});
  assert.deepEqual(named.flat.map((s) => s.id), ['b', 'a', 'c', 'd', 'e', 'f']);
  assert.deepEqual(named.projects.find((p) => p.dir.id === 'd1').sessions.map((s) => s.id), ['b', 'a']);
  assert.equal(JSON.stringify(t), before);
});

test('archived sessions leave sidebar, notifications and automatic movie session selection; undo restores them', () => {
  const archived = sessions.map((s) => ({...s, archived: true}));
  const t = P.tree({dirs, movies, sessions: archived});
  assert.equal(P.sidebarView(t).flat.length, 0);
  assert.ok(t.pinned.every((x) => x.kind === 'dir'));
  assert.deepEqual(P.attention(archived), []);
  assert.equal(P.sessionForMovie('m1', movies, archived).sid, null);
  assert.equal(P.sessionForMovie('m3', movies, archived).sid, null);
  assert.equal(P.fitsMovie(archived[0], 'm1', movies), false);
  const restored = archived.map((s) => ({...s, archived: false}));
  assert.equal(P.sidebarView(P.tree({dirs, movies, sessions: restored})).flat.length, sessions.length);
});

test('对话产物只包含消息引用和本会话输出，同项目其他视频不混入', () => {
  const items = [
    {id:'p1', kind:'movie', name:'双语版'}, {id:'p2', kind:'movie', name:'同项目其他视频'},
    {id:'o1', kind:'subtitle', session:'s1', status:'published', messageId:'a1'}, {id:'o2', kind:'doc', session:'s2'},
    {id:'gone', kind:'image', session:'s1', trashed:true},
  ];
  const sess = {id:'s1', project:'p2', messages:[
    {id:'r1', role:'receipt', taskId:'t1'}, {id:'r2', role:'receipt', movieId:'p1'},
    {id:'a1', role:'assistant'},
  ]};
  const out = P.sessionArtifacts(sess, items, [{id:'t1', project:'p1'}]);
  assert.deepEqual(out.map(it => it.id), ['p1','o1']);
  assert.equal(items[0].messageId, undefined);
});

test('绑定或读取视频不算产物；显式引用支持多视频并忽略丢失项', () => {
  const items = [{id:'p1',kind:'movie'},{id:'p2',kind:'movie'}];
  assert.deepEqual(P.sessionArtifacts({id:'s',project:'p1',messages:[{id:'u',role:'user'}]},items), []);
  assert.deepEqual(P.sessionArtifacts(null,items), []);
  const sess = {id:'s',project:'p2',messages:[
    {id:'a',role:'assistant',artifactIds:['p1','p2','missing']},
    {id:'r',role:'receipt',movieId:null},
  ]};
  assert.deepEqual(P.sessionArtifacts(sess,items).map(it => [it.id,it.messageId]), [['p1','a'],['p2','a']]);
});

test('纯文档会话把产物放在回答后；旧收据仍可回看目标视频', () => {
  const items = [{id:'doc',kind:'doc',session:'s',status:'candidate',messageId:'a'},{id:'p1',kind:'movie'}];
  assert.deepEqual(P.sessionArtifacts({id:'s',messages:[{id:'a',role:'assistant'}]},items).map(it => [it.id,it.messageId]), [['doc','a']]);
  assert.deepEqual(P.sessionArtifacts({id:'old',project:'p1',messages:[{id:'r',role:'receipt'}]},items).map(it=>it.id), ['p1']);
});


test('仅有来源会话的引用素材不算产物；文档没有新的引用就留在原处，记的消息不在会话里只进汇总', () => {
  const items = [{id:'source',kind:'image',session:'s'},
    {id:'doc',kind:'doc',session:'s',status:'candidate',messageId:'a'},
    {id:'unknown',kind:'doc',session:'s',status:'published',messageId:'missing'}];
  const out = P.sessionArtifacts({id:'s',messages:[{id:'a',role:'assistant'},{id:'later',role:'assistant'}]},items);
  assert.deepEqual(out.map(it=>[it.id,it.messageId]), [['doc','a'],['unknown',null]]);
});

test('视频卡的锚点：工具消息指向的任务是这部视频就出现，同一回合挪到最后一条引用（后来的工具消息、收据）', () => {
  const items = [{id:'p1',kind:'movie'},{id:'p2',kind:'movie'}];
  const tasks = [{id:'dl', kind:'download', project:null}, {id:'tx', kind:'transcribe', project:'p1'}, {id:'tl', kind:'translate', project:'p1'}];
  const sess = {id:'s', project:'p1', messages:[
    {id:'u',role:'user'}, {id:'w1',role:'tool',taskId:'dl'}, {id:'w2',role:'tool',taskId:'tx'},
    {id:'w3',role:'tool',taskId:'tl'}, {id:'r',role:'receipt',taskId:'tx',movieId:'p1'},
  ]};
  assert.deepEqual(P.sessionArtifacts(sess,items,tasks).map(it => [it.id,it.messageId,it.taskIds]), [['p1','r',['tx','tl']]]);
  // 只到转录开始那一刻，卡挂在转录那条工具消息上
  assert.deepEqual(P.sessionArtifacts({...sess, messages: sess.messages.slice(0, 3)},items,tasks).map(it => [it.id,it.messageId]), [['p1','w2']]);
  // 下载完成、视频建好（任务的 project 补上）后，视频卡原位出现在下载那一条工具消息上
  const done = tasks.map(t => t.id === 'dl' ? {...t, project:'p2'} : t);
  assert.deepEqual(P.sessionArtifacts(sess,items,done).map(it => [it.id,it.messageId]), [['p2','w1'],['p1','r']]);
});

test('创建项目校验名称与父目录，在选择的位置生成不冲突的项目路径', () => {
  assert.equal(P.dirCreationError('新片', '~/Movies/'), '');
  for (const name of ['', '..', 'a/b', 'a\\b']) assert.ok(P.dirCreationError(name, '~/Movies/'));
  for (const parent of ['', 'Movies/', '~/../', '/tmp/./', '/tmp/\n']) assert.ok(P.dirCreationError('新片', parent));
  const d = P.newDir([], 'new', ' 新片 ', '~/Movies');
  assert.equal(d.path, '~/Movies/新片/');
  assert.equal(P.newDir([d], 'next', '新片', '~/Movies').path, '~/Movies/新片-2/');
  assert.equal(P.newDir([{name: '另一个名字', path: '~/Movies/新片/'}], 'next', '新片', '~/Movies').path, '~/Movies/新片-2/');
  assert.equal(P.newDir([], 'default', '新片').path, '~/BaoCut/新片/');
});

test('视频卡一条会话一张：后面的回合再引用，卡挪到最新一条引用，前面的回合不再有它；卡上是全部的活', () => {
  const items = [{id:'p1',kind:'movie'}];
  const tasks = [{id:'tx',kind:'transcribe',project:'p1'}, {id:'tl',kind:'translate',project:'p1'}, {id:'ex',kind:'export',project:'p1'}];
  const sess = {id:'s', project:'p1', messages:[
    {id:'u1',role:'user'}, {id:'w1',role:'tool',taskId:'tx'}, {id:'r1',role:'receipt',taskId:'tx',movieId:'p1'}, {id:'a1',role:'assistant'},
    {id:'u2',role:'user'}, {id:'w2',role:'tool',taskId:'tl'}, {id:'w3',role:'tool',taskId:'ex'}, {id:'r2',role:'receipt',taskId:'tl',movieId:'p1'},
    {id:'u3',role:'user'}, {id:'a3',role:'assistant'},
  ]};
  assert.deepEqual(P.sessionArtifacts(sess, items, tasks).map(it => [it.id, it.messageId, it.turn, it.taskIds]),
    [['p1','r2',1,['tx','tl','ex']]]);
  // 只到第一轮时卡在第一轮的收据后面
  assert.deepEqual(P.sessionArtifacts({...sess, messages: sess.messages.slice(0, 4)}, items, tasks).map(it => [it.messageId, it.turn]), [['r1',0]]);
  assert.deepEqual(P.artifactList(sess, items, tasks).map(it => [it.id, it.messageId, it.turn]), [['p1','r2',undefined]]);
});

/* 还在跑的活跟着最新一轮走（product-design §3.2.2 视频卡）：比用户消息的 startedAt 与任务的 endedAt */
const carry = (status, endedAt) => {
  const items = [{id:'p1',kind:'movie'}];
  const tasks = [{id:'tx',kind:'transcribe',project:'p1',status, endedAt}];
  const sess = {id:'s', project:'p1', messages:[
    {id:'u1',role:'user',startedAt:1000}, {id:'w1',role:'tool',taskId:'tx'}, {id:'a1',role:'assistant'},
    {id:'u2',role:'user',startedAt:2000}, {id:'a2',role:'assistant'},
  ]};
  return {items, tasks, sess};
};

test('视频卡跟着还在跑的活：新一轮开始时转录没完，卡挪到最新一轮最后一条后面，原来那一轮不再有它', () => {
  const {items, tasks, sess} = carry('running');
  assert.deepEqual(P.sessionArtifacts(sess, items, tasks).map(it => [it.id, it.messageId, it.turn, it.taskIds]),
    [['p1','a2',1,['tx']]]);
  // 新一轮只有用户那一句时挂在它后面；排队中的同样算没结束
  const just = {...sess, messages: sess.messages.slice(0, 4)};
  assert.deepEqual(P.sessionArtifacts(just, items, carry('queued').tasks).map(it => [it.messageId, it.turn]), [['u2',1]]);
});

test('视频卡跟着还在跑的活：下一轮开始前已经结束的留在原处', () => {
  const {items, tasks, sess} = carry('done', 1500);
  assert.deepEqual(P.sessionArtifacts(sess, items, tasks).map(it => [it.messageId, it.turn, it.taskIds]), [['w1',0,['tx']]]);
  // 失败、取消同样按结束时间算
  assert.deepEqual(P.sessionArtifacts(sess, items, carry('error', 1800).tasks).map(it => it.turn), [0]);
});

test('视频卡跟着还在跑的活：在第二轮里结束，第三轮开始后仍留在第二轮，不挪回去', () => {
  const {items, sess} = carry();
  const tasks = [{id:'tx',kind:'transcribe',project:'p1',status:'done',endedAt:2500}];
  const three = {...sess, messages: sess.messages.concat([{id:'u3',role:'user',startedAt:3000}, {id:'a3',role:'assistant'}])};
  assert.deepEqual(P.sessionArtifacts(three, items, tasks).map(it => [it.messageId, it.turn]), [['a2',1]]);
  // 一直在跑就一直跟到最新一轮
  assert.deepEqual(P.sessionArtifacts(three, items, carry('running').tasks).map(it => [it.messageId, it.turn]), [['a3',2]]);
});

test('视频卡跟着还在跑的活：新一轮也引用了这部视频时仍是一张，活按第一次引用排；别的视频的卡不动', () => {
  const items = [{id:'p1',kind:'movie'},{id:'p2',kind:'movie'}];
  const tasks = [{id:'tx',kind:'transcribe',project:'p1',status:'running'}, {id:'ex',kind:'export',project:'p2',status:'done',endedAt:1200},
    {id:'tl',kind:'translate',project:'p1',status:'running'}];
  const sess = {id:'s', project:'p1', messages:[
    {id:'u1',role:'user',startedAt:1000}, {id:'w1',role:'tool',taskId:'tx'}, {id:'w2',role:'tool',taskId:'ex'}, {id:'a1',role:'assistant'},
    {id:'u2',role:'user',startedAt:2000}, {id:'w3',role:'tool',taskId:'tl'}, {id:'a2',role:'assistant'},
  ]};
  assert.deepEqual(P.sessionArtifacts(sess, items, tasks).map(it => [it.id, it.messageId, it.turn, it.taskIds]),
    [['p1','a2',1,['tx','tl']], ['p2','w2',0,['ex']]]);
  assert.deepEqual(P.artifactList(sess, items, tasks).map(it => [it.id, it.messageId]), [['p1','a2'],['p2','w2']]);
});
