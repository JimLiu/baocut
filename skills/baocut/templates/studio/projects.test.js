const test = require('node:test');
const assert = require('node:assert/strict');
const PJ = require('./projects.js');

function fakeStorage(init) {
  const map = Object.assign({}, init);
  return {
    getItem: (k) => (k in map ? map[k] : null),
    setItem: (k, v) => { map[k] = String(v); },
    _map: map,
  };
}

test('isProjectsRoute 只认 /projects 与 /projects/', () => {
  assert.equal(PJ.isProjectsRoute('/projects'), true);
  assert.equal(PJ.isProjectsRoute('/projects/'), true);
  // 项目页、tab 深链、单项目模式的根都不是列表页
  assert.equal(PJ.isProjectsRoute('/projects/p1/'), false);
  assert.equal(PJ.isProjectsRoute('/projects/p1/subtitle'), false);
  assert.equal(PJ.isProjectsRoute('/'), false);
  assert.equal(PJ.isProjectsRoute(''), false);
  assert.equal(PJ.isProjectsRoute('/p1/'), false);
  assert.equal(PJ.isProjectsRoute(null), false);
});

test('projectHref 带尾斜杠并转义 id', () => {
  assert.equal(PJ.projectHref('p1'), '/projects/p1/');
  assert.equal(PJ.projectHref('p128-用-codex'), '/projects/p128-%E7%94%A8-codex/');
});

test('searchProjects 大小写无关地匹配标题/路径/id，空查询原样返回', () => {
  const list = [
    { id: 'p1', title: 'Agentic harness', path: '/work/a.bcut' },
    { id: 'p2', title: '技能是什么', path: '/work/skills.bcut' },
    { id: 'p3', title: null, path: '/tmp/x.bcut' },
  ];
  assert.equal(PJ.searchProjects(list, ''), list);
  assert.equal(PJ.searchProjects(list, '   '), list);
  assert.deepEqual(PJ.searchProjects(list, 'AGENTIC').map((p) => p.id), ['p1']);
  assert.deepEqual(PJ.searchProjects(list, '技能').map((p) => p.id), ['p2']);
  assert.deepEqual(PJ.searchProjects(list, '/work/').map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(PJ.searchProjects(list, 'p3').map((p) => p.id), ['p3']);
  assert.deepEqual(PJ.searchProjects(list, '找不到'), []);
  assert.deepEqual(PJ.searchProjects(null, 'x'), []);
});

test('视图偏好只在 grid/list 之间取值，脏值回落 grid', () => {
  assert.equal(PJ.loadView(null), 'grid');
  assert.equal(PJ.loadView(fakeStorage({})), 'grid');
  assert.equal(PJ.loadView(fakeStorage({ [PJ.VIEW_KEY]: 'list' })), 'list');
  assert.equal(PJ.loadView(fakeStorage({ [PJ.VIEW_KEY]: 'table' })), 'grid');
  const s = fakeStorage({});
  PJ.saveView(s, 'list');
  assert.equal(s._map[PJ.VIEW_KEY], 'list');
  PJ.saveView(s, 'nonsense');
  assert.equal(s._map[PJ.VIEW_KEY], 'grid');
});

test('thumbUrl 只给有时长的视频项目，t 吸在 min(1, 时长/2)', () => {
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: 600 }, 320),
    '/projects/p1/__bcut/thumb?t=1&w=320');
  // 短片不越界
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: 1.2 }, 112),
    '/projects/p1/__bcut/thumb?t=0.6&w=112');
  // 宽度缺省 320，非法宽度也回落
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: 30 }),
    '/projects/p1/__bcut/thumb?t=1&w=320');
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: 30 }, 0),
    '/projects/p1/__bcut/thumb?t=1&w=320');
  // 非视频 / 无时长 / 空条目 → 没有帧可抽
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'audio', duration: 30 }, 320), null);
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: 0 }, 320), null);
  assert.equal(PJ.thumbUrl({ id: 'p1', mediaKind: 'video', duration: null }, 320), null);
  assert.equal(PJ.thumbUrl(null, 320), null);
});

test('状态与来源徽标', () => {
  assert.equal(PJ.statusBadge({ transcriptReady: true }).label, '已转录');
  assert.equal(PJ.statusBadge({ transcriptReady: true }).cls, 'vk-badge--complete');
  assert.equal(PJ.statusBadge({ transcriptReady: false }).label, '未转录');
  assert.equal(PJ.statusBadge(null).label, '未转录');
  assert.equal(PJ.sourceLabel({ source: 'mount' }), '挂载');
  assert.equal(PJ.sourceLabel({ source: 'root' }), '当前项目');
  assert.equal(PJ.sourceLabel({ source: 'registry' }), '项目库');
  // dir 是默认情况，不挂徽标
  assert.equal(PJ.sourceLabel({ source: 'dir' }), null);
  assert.equal(PJ.sourceLabel(null), null);
});

test('相对时间与媒体图标复用 panels.js 的实现', () => {
  assert.equal(typeof PJ.relativeTime, 'function');
  assert.equal(typeof PJ.mediaIcon, 'function');
  assert.equal(PJ.mediaIcon('audio'), 'audio-wave');
});
