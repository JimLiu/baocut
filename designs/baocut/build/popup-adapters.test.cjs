const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const {transformSync} = require('esbuild');
const S = new Proxy({Icons: {ChevronDown: 'ChevronDown', Checkmark: 'Checkmark'}}, {get: (o, k) => o[k] || k});
const context = {React, window: {RSP: S}, Ic: 'Icon'};
const source = fs.readFileSync(path.join(__dirname, '../app/ui-spectrum.jsx'), 'utf8');
vm.runInNewContext(transformSync(source, {loader: 'jsx'}).code, context);
const {ChoicePicker, Menu, MenuItem, MenuHead, MenuRule, simpleChoices} = context.window.BC_SPECTRUM;
const h = React.createElement;
const children = node => React.Children.toArray(node.props.children);

test('compact choices keep their requested popup width and a single native selection', () => {
  let picked = null, closed = 0;
  const nodes = [h(MenuItem, {label: '监督', on: true, sub: '执行命令或修改文件前先征求许可', onClick: () => { picked = 'ask'; }}),
    h(MenuItem, {label: '自动', onClick: () => { picked = 'auto'; }})];
  const view = ChoicePicker({nodes, size: 's', popWidth: 288, popDir: 'up', value: '监督', onClose: () => closed++});
  assert.equal(view.type, 'MenuTrigger');
  assert.equal(view.props.direction, 'top');
  const [trigger, menu] = children(view);
  assert.equal(trigger.props.size, 'S');
  assert.equal(menu.props.size, 'M');
  assert.equal(menu.props.UNSAFE_style.width, 288);
  assert.deepEqual([...menu.props.selectedKeys], ['0']);
  menu.props.onAction('1');
  assert.equal(picked, 'auto');
  assert.equal(closed, 1);
});

test('form choices retain native Picker width, groups and disabled items', () => {
  const nodes = [h(MenuHead, {}, '本地'), h(MenuItem, {label: '已安装', on: true}),
    h(MenuRule), h(MenuHead, {}, '云端'), h(MenuItem, {label: '未配置', disabled: true})];
  const view = ChoicePicker({nodes, field: true, popWidth: 320});
  assert.equal(view.type, 'Picker');
  assert.equal(view.props.isQuiet, false);
  assert.equal(view.props.menuWidth, 320);
  assert.deepEqual([...view.props.disabledKeys], ['1']);
  assert.equal(children(view).length, 2);
});

test('nested legacy menu groups become one keyboard collection with native section headings', () => {
  const view = Menu({children: [h(Menu, {}, h(MenuHead, {}, '模型'), h(MenuItem, {label: '默认'})),
    h(MenuRule), h(Menu, {}, h(MenuHead, {}, '推理强度'), h(MenuItem, {label: '中'}))]});
  const menus = children(view);
  assert.equal(menus.length, 1);
  assert.equal(menus[0].type, 'Menu');
  assert.deepEqual(children(menus[0]).map(n => n.type), ['MenuSection', 'MenuSection']);
});

test('complex interactive picker content stays a Popover and is not flattened into choices', () => {
  assert.equal(simpleChoices(h('div', {}, h(MenuItem, {label: '模型'}))), null);
  const nodes = simpleChoices(h(Menu, {}, h(MenuHead, {}, '模型'), h(MenuItem, {label: '默认'})));
  assert.equal(nodes.length, 2);
});
