/* v3 的 Electron / Web 共用 packages/ui，直接用 S2；不再生成 Rust 图标注册表。 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function icons() {
  const asset = Symbol('S2 Asset');
  const window = {RSP: {createIcon: render => render, Icons: {Asset: asset}}};
  const React = {createElement: (type, props, ...children) => ({type, props, children})};
  vm.runInNewContext(read('designs/baocut/app/icons.jsx'), {window, React});
  return {window, asset};
}
test('Space 图标使用 S2 Asset，原型与应用共享语义', () => {
  const {window, asset} = icons();
  assert.equal(window.Ic({n: 'asset'}).type, asset);
  assert.match(read('packages/ui/src/components/rail.tsx'), /@react-spectrum\/s2\/icons\/Asset/);
});
test('外壳图标的 SVG 与应用共享的那份逐字节一致', () => {
  const proto = 'designs/baocut/assets/shell';
  const app = 'packages/ui/src/components/shell-icons';
  const names = dir => fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.svg')).sort();
  assert.deepEqual(names(app), names(proto));
  for (const name of names(proto)) assert.equal(read(`${app}/${name}`), read(`${proto}/${name}`), name);
});
test('Agent 图标的 SVG 与应用 vendor-icons 那份逐字节一致', () => {
  const proto = 'designs/baocut/assets/vendors';
  const app = 'packages/ui/src/components/vendor-icons';
  const names = fs.readdirSync(path.join(root, app)).filter(f => f.endsWith('.svg')).sort();
  assert.ok(names.length >= 9);
  for (const name of names) assert.equal(read(`${app}/${name}`), read(`${proto}/${name}`), name);
});
test('图标适配保留无障碍标签，未知名称不渲染错误图形', () => {
  const {window} = icons();
  assert.equal(window.Ic({n: 'not-an-icon'}), null);
  assert.equal(window.Ic({n: 'play', title: '播放'}).props['aria-label'], '播放');
  assert.equal(window.Ic({n: 'play'}).props['aria-hidden'], true);
});
