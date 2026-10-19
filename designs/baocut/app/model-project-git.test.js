const test = require('node:test');
const assert = require('node:assert');
global.window = {};
require('./model-project-git.js');
const G = global.window.BC_PROJECT_GIT;
const dir = {id: 'd1', name: '科浪访谈 第 42 期', path: '~/BaoCut/科浪访谈-42/'};
const videos = [{id: 'p1', title: '双语版', latest: 14}, {id: 'p2', title: '短视频', latest: 3}];
const ago = (m) => (m < 1 ? '刚刚' : `${m} 分钟前`);

test('每个场景都有状态灯，不是 ready 时有原因与下一步', () => {
  G.SCENARIOS.forEach(({k}) => {
    const st = G.seed(dir, videos, k);
    const l = G.light(st);
    assert.ok(l.label && l.tone, k);
    if (st.state !== 'ready') assert.ok(st.reason && st.remedy, k);
  });
  assert.equal(G.light(G.seed(dir, videos, 'rebase')).label, '已暂停 · 正在变基');
  assert.equal(G.seed(dir, videos, 'detached').branch, null);
  assert.equal(G.light(G.seed(dir, videos, 'unavailable')).label, '没有找到 git');
});

test('提交到 git：只提交有新版本的视频，第二次没有改动', () => {
  const st = G.seed(dir, videos, 'ready');
  const r = G.commit(st, videos);
  assert.equal(r.result.committed, true);
  assert.deepEqual(r.result.videos, [{videoId: 'p1', from: 13, to: 14}, {videoId: 'p2', from: 2, to: 3}]);
  assert.match(G.commitText(r.result, {p1: '双语版', p2: '短视频'}), /^已提交 [0-9a-f]{7}：5 个文件，「双语版」版本 13–14、「短视频」版本 2–3。$/);
  assert.match(G.lastCommitText(r.state.lastCommit, ago), /^上次提交 [0-9a-f]{7} · 手动 · 刚刚$/);
  const again = G.commit(r.state, videos);
  assert.equal(again.result.committed, false);
  assert.match(G.commitText(again.result), /没有要提交的改动/);
});

test('暂停、不在仓库、没有 git、运行失败：提交按协议的错误码拒绝', () => {
  assert.equal(G.commit(G.seed(dir, videos, 'locked'), videos).error.code, 'GIT_PAUSED');
  assert.equal(G.commit(G.seed(dir, videos, 'local-config'), videos).error.code, 'GIT_PAUSED');
  const nr = G.commit(G.seed(dir, videos, 'not-repo'), videos).error;
  assert.deepEqual([nr.code, nr.reason], ['GIT_UNAVAILABLE', 'not-repo']);
  assert.equal(G.commit(G.seed(dir, videos, 'unavailable'), videos).error.reason, 'missing');
  assert.equal(G.commit(G.seed(dir, videos, 'error'), videos).error.code, 'GIT_FAILED');
});

test('初始化 git：主目录、标准用户文件夹、磁盘根目录不提供', () => {
  const ok = G.init(G.seed(dir, videos, 'not-repo'), dir);
  assert.equal(ok.state.state, 'ready');
  assert.equal(ok.state.branch, 'main');
  assert.equal(ok.state.lastCommit, null);
  // 新仓库里所有版本都还没提交
  assert.deepEqual(G.commit(ok.state, videos).result.videos[0], {videoId: 'p1', from: 1, to: 14});
  ['home', 'user-folder', 'volume-root'].forEach((k) => {
    const st = G.seed(dir, videos, k);
    assert.deepEqual(st.init, {allowed: false, refusal: k});
    assert.equal(st.remedy, G.INIT_REFUSAL[k]);
    assert.equal(G.init(st, dir).error.code, 'GIT_INIT_REFUSED');
  });
  assert.equal(G.init(G.seed(dir, videos, 'ready'), dir).error.refusal, 'inside-repo');
});

test('允许本地过滤器：交回看过的摘要才恢复；变了要再看一遍', () => {
  const st = G.seed(dir, videos, 'local-config');
  assert.equal(st.pause.localConfig.entries.length, 3);
  assert.equal(G.allow(st, 'sha256:other').error.code, 'GIT_PAUSED');
  const r = G.allow(st, st.pause.localConfig.digest);
  assert.equal(r.state.state, 'ready');
  assert.equal(r.state.allowed, st.pause.localConfig.digest);
  const ch = G.seed(dir, videos, 'local-config-changed');
  assert.equal(G.light(ch).label, '已暂停 · 本地过滤器变了');
  assert.match(ch.reason, /允许之后/);
});

test('给 Web 的投影不带仓库路径、过滤器条目与素材路径', () => {
  const w = G.forWeb(G.seed(dir, videos, 'local-config'));
  assert.equal(w.repoRoot, undefined);
  assert.equal(w.pause.localConfig.entries, undefined);
  assert.ok(w.pause.localConfig.digest);
  assert.ok(w.outside.length && w.outside.every((o) => !o.path));
  // 原状态不被改
  assert.equal(G.seed(dir, videos, 'local-config').pause.localConfig.entries.length, 3);
});

test('重新检查：锁放开了就恢复，别的暂停不变', () => {
  assert.equal(G.recheck(G.seed(dir, videos, 'locked')).state.state, 'ready');
  assert.equal(G.recheck(G.seed(dir, videos, 'rebase')).same, true);
});
