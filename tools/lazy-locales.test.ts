import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizePath, parseAst, transformWithEsbuild } from 'vite';
import { describe, expect, it } from 'vitest';
import { rewriteLocaleImports } from './lazy-locales.ts';

const I18N = '/repo/packages/protocol/src/i18n.ts';
const FILE = '/repo/packages/ui/src/editor/foo-copy.ts';
const rewrite = (code: string, file = FILE) => rewriteLocaleImports(code, file, I18N);
const lines = (code: string) => code.split('\n').length;

describe('开发服务器只载入当前语言的译文', () => {
  it('译文表里的导入改成按语言登记的动态导入，英文照常静态导入，行号不变', () => {
    const code = [
      "import { defineMessages } from '@baocut/protocol';",
      "import { en } from './foo-copy.en.ts';",
      "import { zhHans } from './foo-copy.zh-Hans.ts';",
      "import { ja } from './foo-copy.ja.ts';",
      '',
      "export const M = defineMessages(en, { 'zh-Hans': zhHans, ja });",
    ].join('\n');
    const out = rewrite(code)!;
    expect(out.files).toEqual(['/repo/packages/ui/src/editor/foo-copy.zh-Hans.ts', '/repo/packages/ui/src/editor/foo-copy.ja.ts']);
    expect(out.code).not.toMatch(/import \{ (zhHans|ja) \} from/);
    expect(out.code).toContain("import { en } from './foo-copy.en.ts';");
    expect(out.code).toContain('import { lazyTranslations as __bcLazyTranslations } from "../../../protocol/src/i18n.ts";');
    expect(out.code).toContain(
      'const [zhHans] = __bcLazyTranslations("zh-Hans", "/repo/packages/ui/src/editor/foo-copy.zh-Hans.ts", () => import("./foo-copy.zh-Hans.ts"), ["zhHans"]);',
    );
    expect(out.code).toContain('const [ja] = __bcLazyTranslations("ja", "/repo/packages/ui/src/editor/foo-copy.ja.ts", () => import("./foo-copy.ja.ts"), ["ja"]);');
    expect(lines(out.code)).toBe(lines(code));
    expect(out.code.split('\n').at(-1)).toBe("export const M = defineMessages(en, { 'zh-Hans': zhHans, ja });");
    expect(() => parseAst(out.code)).not.toThrow();
  });

  it('一个译文文件的几个导出（含改名的、默认导出）共用一次动态导入；defineCatalog 看第三个参数', () => {
    const code = [
      "import { defineCatalog, defineMessages } from '@baocut/protocol';",
      "import jaRest, { commonJa as common, webJa } from './bar.ja.ts';",
      "export const A = defineMessages(enA, { ja: common });",
      "export const B = defineCatalog('bar', enB, { ja: webJa });",
      "export const C = defineMessages(enC, { ja: jaRest });",
    ].join('\n');
    const out = rewrite(code)!;
    expect(out.code).toContain('const [jaRest, common, webJa] = __bcLazyTranslations("ja", "/repo/packages/ui/src/editor/bar.ja.ts", () => import("./bar.ja.ts"), ["default","commonJa","webJa"]);');
    expect(out.code.match(/import\("/g)).toHaveLength(1);
  });

  it('拼进别的对象、另作他用、放在别的语言下、同名局部变量或在导入之前用到的，照常静态导入', () => {
    const code = [
      "import { zhReasons } from './r.zh-Hans.ts';",
      "import { jaReasons } from './r.ja.ts';",
      "import { it } from './r.it.ts';",
      "import { ko } from './r.ko.ts';",
      "import { es } from './r.es.ts';",
      "import * as fr from './r.fr.ts';",
      "import { de } from './r.de.ts';",
      "import { ptBR } from './r.pt-BR.ts';",
      "export const R = defineMessages({ reasons: en }, { 'zh-Hans': { reasons: zhReasons }, ja: jaReasons });",
      'export const paths = (list) => list.map((it) => it.path);',
      'export const I = defineMessages(en, { it, ko, fr });',
      'export { es };',
      "export const D = defineMessages(en, { de: es.de, nl: de });",
      "export const P = defineMessages(en, { 'pt-BR': ptBR });",
      'export const order = defineMessages(en, { es });',
    ].join('\n');
    const out = rewrite(code)!;
    expect(out.code).toContain("import { zhReasons } from './r.zh-Hans.ts';");
    expect(out.code).toContain("import { it } from './r.it.ts';");
    expect(out.code).toContain("import { es } from './r.es.ts';");
    expect(out.code).toContain("import * as fr from './r.fr.ts';");
    expect(out.code).toContain("import { de } from './r.de.ts';");
    expect(out.files).toEqual(['/repo/packages/ui/src/editor/r.ja.ts', '/repo/packages/ui/src/editor/r.ko.ts', '/repo/packages/ui/src/editor/r.pt-BR.ts']);

    const early = ["import { ja } from './e.ja.ts';", "const E = defineMessages(en, { ja });", "import { en } from './e.en.ts';"].join('\n');
    expect(rewrite(early)).toBeNull();
  });

  it('没有译文导入、或者解析不了时不改写', () => {
    expect(rewrite("import { a } from './a.ts';\nexport const b = a;")).toBeNull();
    expect(rewrite("import { ja } from './a.ja.ts';\nconst x: number = defineMessages(en, { ja });")).toBeNull();
  });

  it('真实的文案目录经 esbuild 去掉类型后，十四种语言的导入全部改写', async () => {
    const path = normalizePath(fileURLToPath(new URL('../packages/ui/src/components/editor/edit-aids-copy.ts', import.meta.url)));
    const { code } = await transformWithEsbuild(readFileSync(path, 'utf8'), path);
    const out = rewriteLocaleImports(code, path)!;
    expect(out.files).toHaveLength(14);
    expect(out.code).toContain('import { lazyTranslations as __bcLazyTranslations } from "../../../../protocol/src/i18n.ts";');
    expect(out.code).not.toMatch(/^import .* from "\.\/edit-aids-copy\.(?!ts")/m);
    expect(() => parseAst(out.code)).not.toThrow();
  });
});
