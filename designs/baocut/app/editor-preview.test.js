const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the playback hook's effects after each render, with captured render values.
// This catches entry/restore races without wall-clock timers or DOM mocks.
function harness(initial) {
  const state = {peek: null, playT: 12.4, playing: false, muted: false, ...initial};
  const cells = [];
  let index = 0, effects = [];
  const React = {
    useRef: (v) => cells[index++] ||= {current: v},
    useEffect: (fn, deps) => {
      const i = index++;
      if (!cells[i] || deps.some((v, n) => v !== cells[i][n])) effects.push(fn);
      cells[i] = deps;
    },
  };
  const context = vm.createContext({window: {}, React});
  for (const file of ['model-preview.js', 'editor-preview.jsx']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  }
  const preview = {current: {win: null, snap: null}};
  const render = () => {
    index = 0; effects = [];
    context.window.usePreviewPlayback(preview, {...state,
      setPlayT: (v) => { state.playT = v; }, setPlaying: (v) => { state.playing = v; },
      setMuted: (v) => { state.muted = v; }, setPeek: (v) => { state.peek = v; }});
    effects.forEach((fn) => fn());
  };
  render();
  return {state, preview, render};
}
test('片段预览从片头开始，即使原播放头在片尾之后，也不被入口旧帧提前结束', () => {
  const h = harness();
  h.state.peek = {kind: 'segment', once: true, win: {t0: 2, t1: 5}};
  h.render();
  assert.equal(h.state.playT, 2);
  assert.equal(h.state.playing, true);
  assert.equal(h.state.muted, false);
  assert.ok(h.state.peek);
  h.render();
  h.state.playT = 5; h.render(); h.render();
  assert.equal(h.state.peek, null);
  assert.equal(h.state.playT, 12.4);
  assert.equal(h.state.playing, false);
  assert.equal(h.preview.current.hold, 12.4);
});
test('片段预览按停止或 Esc 撤回，恢复进入前的播放和静音状态', () => {
  const h = harness({playing: true, muted: true});
  h.state.peek = {kind: 'segment', once: true, win: {t0: 2, t1: 5}};
  h.render(); h.render();
  h.state.peek = null; h.render();
  assert.equal(h.state.playT, 12.4);
  assert.equal(h.state.playing, true);
  assert.equal(h.state.muted, true);
  assert.equal(h.preview.current.hold, null);
});
test('局部悬停不写播放状态，切换卡片或离开也不触发全局快照恢复', () => {
  const h = harness();
  for (const peek of [{localWin: {t0: 2, t1: 3}}, {localWin: {t0: 4, t1: 5}}, null]) {
    h.state.peek = peek; h.render();
    assert.equal(h.state.playT, 12.4);
    assert.equal(h.state.playing, false);
    assert.equal(h.state.muted, false);
    assert.equal(h.preview.current.snap, null);
  }
});
