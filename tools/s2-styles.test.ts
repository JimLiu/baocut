import { fileURLToPath } from 'node:url';
import { parseAst, transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';
import { inlineStyleImports, s2StylesInTests } from './s2-styles.ts';

const CLIENT = '/repo/tools/s2-styles-client.ts';
const A = `macro-${'a'.repeat(64)}.css`;
const B = `macro-${'b'.repeat(64)}.css`;
const COMPONENT = '/repo/node_modules/@react-spectrum/s2/dist/private/Button.css';
const STYLES: Record<string, string> = { [A]: '@layer _.a{.a{color:red}}', [B]: '@layer _.b{.b{top:0}}', [COMPONENT]: '@layer _.c{.c{left:0}}' };
const styleOf = (source: string) => STYLES[source];
const inline = (code: string, always = false) => inlineStyleImports(code, '/repo/src/view.tsx', styleOf, { client: CLIENT, always });
const lines = (code: string) => code.split('\n').length;

describe('开发时把模块末尾的 S2 样式导入内联进模块', () => {
  it('末尾连续的样式导入改成一次登记，按导入的先后、重复的只算一次；前面的行不变', async () => {
    // style 宏把导入追加在源文件最后；经 esbuild 去掉类型、转换 JSX 之后仍在最后。
    const source = [
      "import { Button } from '@react-spectrum/s2';",
      "import { helper } from './helper.ts';",
      'export const View = (props: { label: string }) => <Button>{helper(props.label)}</Button>;',
      `import "${A}";`,
      `import "${B}";`,
      `import "${A}";`,
    ].join('\n');
    const { code } = await transformWithEsbuild(source, '/repo/src/view.tsx', { jsx: 'automatic' });
    const out = inline(code)!;
    expect(out).not.toMatch(/import "macro-/);
    const [kept, added] = [out.slice(0, out.lastIndexOf('\n;import')), out.slice(out.lastIndexOf('\n;import') + 1)];
    expect(lines(kept)).toBe(lines(code));
    expect(kept.split('\n').slice(0, 4)).toEqual(code.split('\n').slice(0, 4));
    expect(added).toBe(
      `;import { addStyles as __bcAddStyles } from "${CLIENT}";` +
        `__bcAddStyles("/repo/src/view.tsx", ${JSON.stringify([
          [A, STYLES[A]],
          [B, STYLES[B]],
        ])});` +
        'if (import.meta.hot) import.meta.hot.prune(() => __bcAddStyles("/repo/src/view.tsx", []));\n',
    );
    expect(() => parseAst(out)).not.toThrow();
  });

  it('预构建依赖里排在最后的组件 CSS 也内联；夹在其他依赖之间的、认不得的照常单独引入', () => {
    const code = [`import "${A}";`, 'import { x } from "./chunk-1.js";', `import "${COMPONENT}";`, 'export { x };', `import "${B}";`].join('\n');
    const out = inline(code)!;
    expect(out).toContain(`import "${A}";`);
    expect(out).toContain(JSON.stringify([
      [COMPONENT, STYLES[COMPONENT]],
      [B, STYLES[B]],
    ]));
    expect(out.split('\n').slice(0, 5)).toEqual([`import "${A}";`, 'import { x } from "./chunk-1.js";', '', 'export { x };', '']);

    // 最后一条依赖不是样式导入（re-export、带导入名的、认不得的 CSS），一条也不改。
    expect(inline(`import "${A}";\nexport * from "./chunk-2.js";`)).toBeNull();
    expect(inline(`import "${A}";\nimport { y } from "./y.js";`)).toBeNull();
    expect(inline(`import "${A}";\nimport "./app.css";`)).toBeNull();
  });

  it('越过 React Refresh 加在最后的运行时导入', () => {
    const code = [
      'export const View = () => null;',
      `import "${A}";`,
      '$RefreshReg$(_c, "View");',
      'import * as RefreshRuntime from "/@react-refresh";',
      'if (import.meta.hot) RefreshRuntime.__hmr_import(import.meta.url);',
    ].join('\n');
    const out = inline(code)!;
    expect(out.split('\n').slice(0, 5)).toEqual(['export const View = () => null;', '', '$RefreshReg$(_c, "View");', 'import * as RefreshRuntime from "/@react-refresh";', 'if (import.meta.hot) RefreshRuntime.__hmr_import(import.meta.url);']);
    expect(out).toContain(JSON.stringify([[A, STYLES[A]]]));
  });

  it('有顶层 await 的模块不改；函数里的 await 不算', () => {
    expect(inline(`const data = await fetch("/x");\nimport "${A}";`)).toBeNull();
    expect(inline(`for await (const x of list) {}\nimport "${A}";`)).toBeNull();
    expect(inline(`export async function load() { await fetch("/x"); }\nimport "${A}";`)).not.toBeNull();
  });

  it('以前内联过的模块一份样式也不剩时登记一次空的；解析不了的不改', () => {
    expect(inline('export const x = 1;')).toBeNull();
    expect(inline('export const x = 1;', true)).toContain('__bcAddStyles("/repo/src/view.tsx", []);');
    expect(inline(`const x: number = 1;\nimport "${A}";`)).toBeNull();
  });
});

describe('测试里的 style 宏 CSS', () => {
  type Hook = (this: unknown, ...args: string[]) => unknown;
  const SOURCE = "import { style } from '@react-spectrum/s2/style' with { type: 'macro' };\nexport const root = style({ display: 'flex' });\n";
  const FILE = fileURLToPath(new URL('./s2-styles-fixture.tsx', import.meta.url));

  it('宏插件重新转换文件、CSS 暂时不在它的表里时，同名的 CSS 仍解析得到，且是空模块', async () => {
    const [testStyles, macro] = s2StylesInTests() as unknown as [Record<'resolveId' | 'load', Hook>, Record<'transform' | 'loadInclude', Hook>];
    const context = { addWatchFile() {} };
    const { code } = (await macro.transform.call(context, SOURCE, FILE)) as { code: string };
    const css = code.match(/macro-[0-9a-f]{64}\.css/)![0];
    expect(macro.loadInclude(css)).toBe(true);

    const again = macro.transform.call(context, SOURCE, FILE);
    // 另一个 Vite 环境转换同一个文件时就是这段空当。这条不再成立说明宏插件改了删除的做法，可以去掉 s2StylesInTests 的绕行。
    expect(macro.loadInclude(css)).toBe(false);
    expect(testStyles.resolveId(css)).toBe(css);
    expect(testStyles.load(css)).toBe('');
    await again;
  });

  it('只接管宏 CSS，别的模块照常解析', () => {
    const [testStyles] = s2StylesInTests() as unknown as [Record<'resolveId' | 'load', Hook>];
    expect(testStyles.resolveId(COMPONENT)).toBeUndefined();
    expect(testStyles.load(COMPONENT)).toBeUndefined();
    expect(testStyles.resolveId('macro-not-a-hash.css')).toBeUndefined();
  });
});
