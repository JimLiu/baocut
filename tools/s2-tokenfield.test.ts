// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parseAst } from 'vite';
import { TokenFieldValue } from 'react-stately/useTokenFieldState';
import { afterEach, expect, it } from 'vitest';
import { patchTokenFieldSelection, tokenFieldSelectionPlugin } from './s2-tokenfield.mjs';

const require = createRequire(import.meta.url);
const modulePath = resolve(dirname(require.resolve('react-aria/useTokenField')), '../private/tokenfield/useTokenField.mjs');
const source = readFileSync(modulePath, 'utf8');

// Execute the pinned dependency's actual selection conversion, including its token handling.
function selection(patched: boolean) {
  const code = patched ? patchTokenFieldSelection(source) : source;
  const functions = parseAst(code).body.filter((node) => node.type === 'FunctionDeclaration' &&
    /\$(?:var\$(?:getPosition(?:DOM)?|rangeToPositions|indexOfNode)|export\$)/.test(node.id!.name));
  const getSelection = functions.find((node) => code.slice(node.start, node.end).includes('rangeToPositions(container, range)'))!;
  return runInNewContext(functions.map((node) => code.slice(node.start, node.end)).join('\n') + `\n${getSelection.id!.name}`,
    { window, Node });
}

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); });

it('reproduces and fixes native IME text-node splits after a newline', () => {
  const root = document.createElement('div');
  const prefix = document.createTextNode('first\n');
  const composing = document.createTextNode("ce's");
  root.append(prefix, composing, document.createElement('br'));
  document.body.append(root);
  const range = document.createRange();
  range.setStart(composing, 0); range.setEnd(composing, 4);
  window.getSelection()!.addRange(range);
  const value = new TokenFieldValue([{type: 'text', text: "first\nce's"}]);
  const before = selection(false)(root);
  expect(value.replaceRangeWithSegments(before[0], before[1], [{type: 'text', text: '测试'}]).toString()).toBe("first\nce's测试");
  const after = selection(true)(root);
  expect(after).toEqual([{index: 0, offset: 6}, {index: 0, offset: 10}]);
  expect(value.replaceRangeWithSegments(after[0], after[1], [{type: 'text', text: '测试'}]).toString()).toBe('first\n测试');
});

it.each([0, 1, 2, 3])('maps a container boundary %i without counting the trailing BR', (offset) => {
  const root = document.createElement('div');
  root.append(document.createTextNode('a\n'), document.createTextNode('日'), document.createElement('br'));
  document.body.append(root);
  const range = document.createRange(); range.setStart(root, offset); range.collapse(true);
  window.getSelection()!.addRange(range);
  const position = {index: 0, offset: [0, 2, 3, 3][offset]};
  expect(selection(true)(root)).toEqual([position, position]);
});

it('preserves token boundaries and text offsets on both sides of a token', () => {
  const root = document.createElement('div');
  root.innerHTML = 'a<span data-react-aria-token>\u200b<b contenteditable="false">slot</b>\u200b</span>b';
  root.prepend(document.createTextNode('first\n'));
  root.append(document.createTextNode('cd'));
  document.body.append(root);
  const range = document.createRange();
  const token = root.querySelector('b')!;
  range.setStart(token, 0); range.setEnd(root.lastChild!, 2);
  window.getSelection()!.addRange(range);
  expect(selection(true)(root)).toEqual([{index: 0, offset: 7}, {index: 2, offset: 3}]);
  const value = new TokenFieldValue([{type:'text',text:'first\na'}, {type:'token',text:'slot',value:{}}, {type:'text',text:'bcd'}]);
  const [start,end] = selection(true)(root);
  expect(value.replaceRangeWithSegments(start,end,[{type:'text',text:'한글'}]).toString()).toBe('first\na한글');
});

it('preserves an ordinary first-line range', () => {
  const root = document.createElement('div'); root.textContent = 'abc'; document.body.append(root);
  const range = document.createRange(); range.setStart(root.firstChild!, 1); range.setEnd(root.firstChild!, 2);
  window.getSelection()!.addRange(range);
  expect(selection(true)(root)).toEqual(selection(false)(root));
});

it('guards the patch point and wires production plus dev prebundling', async () => {
  expect(() => patchTokenFieldSelection('changed upstream')).toThrow('patch point changed');
  expect(() => patchTokenFieldSelection(patchTokenFieldSelection(source))).toThrow('patch point changed');
  const plugin = tokenFieldSelectionPlugin();
  expect((plugin.transform as Function)(source, modulePath).code).toBe(patchTokenFieldSelection(source));
  expect((plugin.transform as Function)(source, '/unrelated/useTokenField.mjs')).toBeUndefined();
  const prebundle = (plugin.config as Function)().optimizeDeps.esbuildOptions.plugins[0];
  let load: Function = () => { throw new Error('prebundle hook missing'); };
  prebundle.setup({onLoad(_options: unknown, callback: Function) { load = callback; }});
  expect((await load({path: modulePath})).contents).toBe(patchTokenFieldSelection(source));
});
