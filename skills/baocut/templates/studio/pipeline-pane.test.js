const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'main.jsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'translate.css'), 'utf8');

test('active AI progress owns the pane instead of stacking above a tab body', () => {
  // 不钉整行：样式层落地后这个 div 还带了 inert（层在场时盖住的内容退出 tab 序）
  const views = main.indexOf('className="vk-rpane__views"');
  const liveHeader = main.indexOf('<window.LiveHeader');

  assert.ok(views >= 0);
  assert.ok(liveHeader > views, 'LiveHeader must be mounted inside the views region');
  assert.equal((main.match(/<window\.LiveHeader/g) || []).length, 1);
  assert.match(main, /pipelineActive \? \(\s*<div className="bcs-pipeline-pane"/);
  assert.doesNotMatch(main, /pipelineActive \? <window\.LiveHeader/);
  assert.match(css, /\.bcs-pipeline-pane\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;/s);
  assert.doesNotMatch(css, /\.tr-live__feedtoggle/);
});
