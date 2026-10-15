// 开发服务器（Electron 渲染进程与 Web 客户端）只载入当前语言的译文。
//
// 文案目录静态导入全部语言的译文文件（`foo-copy.ja.ts`…）。开发时 Vite 不打包，整页重载要逐个取三千多个译文模块，
// 白屏的大半时间花在这上面。这里把目录模块对非英文译文文件的静态导入改写成按语言登记的动态导入（@baocut/protocol
// i18n 的 `lazyTranslations`）：当前语言的在第一次渲染前取齐（入口等 `localeReady`），其他语言换过去之前再取。
// 英文是键与兜底，照常静态导入。
//
// 只改写译文直接作为 `defineMessages` / `defineCatalog` 译文表参数里一项的导入；拼进别的对象、另作他用的照常静态导入。
// 界面跨语言读的目录（例如按所有语言比对默认名字）在文件里写 `i18n-all-locales`，整份照常静态导入。
// 出货包、测试、Runtime 与 CLI 不经过这里，全部译文照常打进去。

import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, parseAst, type Plugin } from 'vite';
import { LOCALES } from '../packages/protocol/src/i18n.ts';

// 用 import.meta.url 而不是 import.meta.dirname：electron-vite 打包配置文件时只按文件替换前者。
const I18N = normalizePath(fileURLToPath(new URL('../packages/protocol/src/i18n.ts', import.meta.url)));

/** 文件里有它时整份照常静态导入全部语言。 */
export const ALL_LOCALES_MARK = 'i18n-all-locales';

const LAZY = LOCALES.filter((locale) => locale !== 'en').join('|');
const LOCALE_FILE = new RegExp(`\\.(${LAZY})\\.tsx?$`);
const LOCALE_IMPORT = new RegExp(`\\.(${LAZY})\\.tsx?['"]`);
/** 译文表在调用参数里的位置。 */
const TRANSLATIONS_ARG: Readonly<Record<string, number>> = { defineMessages: 1, defineCatalog: 2 };

interface EsNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface Candidate {
  locale: string;
  source: string;
  names: string[];
  locals: string[];
}

function walk(node: EsNode, parents: EsNode[], visit: (node: EsNode, parents: EsNode[]) => void): void {
  visit(node, parents);
  parents.push(node);
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && typeof (child as EsNode).type === 'string') walk(child as EsNode, parents, visit);
    }
  }
  parents.pop();
}

/** 属性名、成员名这类不是引用的标识符。 */
function isName(node: EsNode, parent: EsNode): boolean {
  if (parent.type === 'MemberExpression') return parent.property === node && !parent.computed;
  if (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') {
    return parent.key === node && parent.value !== node && !parent.computed;
  }
  return false;
}

/** `defineMessages(en, { ja })`、`defineCatalog(area, en, { 'zh-Hans': zhHans })` 译文表里这种语言的一项。 */
function isTranslationEntry(node: EsNode, parents: EsNode[], locale: string): boolean {
  const [call, object, property] = parents.slice(-3);
  if (property?.type !== 'Property' || property.value !== node || property.kind !== 'init' || property.method || property.computed) return false;
  const key = property.key as EsNode;
  if ((key.type === 'Identifier' ? key.name : key.value) !== locale) return false;
  if (object?.type !== 'ObjectExpression' || call?.type !== 'CallExpression') return false;
  const callee = call.callee as EsNode;
  const index = callee.type === 'Identifier' ? TRANSLATIONS_ARG[callee.name as string] : undefined;
  return index !== undefined && (call.arguments as EsNode[])[index] === object;
}

/**
 * 改写一个已经去掉类型的模块（esbuild 之后）；没有可改写的导入时 null。只动导入那几行，其余位置不变，
 * 所以前面的 source map 照用。`files` 是改成按需载入的译文文件。
 */
export function rewriteLocaleImports(code: string, file: string, i18n = I18N): { code: string; files: string[] } | null {
  if (!LOCALE_IMPORT.test(code)) return null;
  let program: EsNode;
  try {
    program = parseAst(code) as unknown as EsNode;
  } catch {
    // 解析不了（还没去掉类型、带 JSX）就不改写，照常静态导入。
    return null;
  }
  const imports = (program.body as EsNode[]).filter((node) => node.type === 'ImportDeclaration');
  const candidates = new Map<EsNode, Candidate>();
  const owners = new Map<string, EsNode>();
  for (const declaration of imports) {
    const source = (declaration.source as EsNode).value as string;
    const locale = LOCALE_FILE.exec(source)?.[1];
    const specifiers = declaration.specifiers as EsNode[];
    if (!locale || !source.startsWith('.') || specifiers.length === 0) continue;
    if (specifiers.some((specifier) => specifier.type === 'ImportNamespaceSpecifier')) continue;
    const names = specifiers.map((specifier) => {
      if (specifier.type === 'ImportDefaultSpecifier') return 'default';
      const imported = specifier.imported as EsNode;
      return (imported.type === 'Identifier' ? imported.name : imported.value) as string;
    });
    const locals = specifiers.map((specifier) => (specifier.local as EsNode).name as string);
    candidates.set(declaration, { locale, source, names, locals });
    for (const local of locals) owners.set(local, declaration);
  }
  if (candidates.size === 0) return null;

  // 生成的常量放在最后一条导入之后：每处引用都得在那之后、而且是译文表里同一种语言的一项，否则这条照常静态导入。
  // 不分作用域：同名的局部变量（`(it) => it.path`）也算，宁可少改。
  const lastImportEnd = Math.max(...imports.map((node) => node.end));
  walk(program, [], (node, parents) => {
    if (node.type !== 'Identifier') return;
    const declaration = owners.get(node.name as string);
    const parent = parents.at(-1);
    if (!declaration || !parent || parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || isName(node, parent)) return;
    if (node.start < lastImportEnd || !isTranslationEntry(node, parents, candidates.get(declaration)?.locale ?? '')) candidates.delete(declaration);
  });
  if (candidates.size === 0) return null;

  let i18nSpecifier = posix.relative(posix.dirname(file), i18n);
  if (!i18nSpecifier.startsWith('.')) i18nSpecifier = `./${i18nSpecifier}`;
  const files: string[] = [];
  let generated = `;import { lazyTranslations as __bcLazyTranslations } from ${JSON.stringify(i18nSpecifier)};`;
  for (const { locale, source, names, locals } of candidates.values()) {
    const target = normalizePath(resolve(dirname(file), source));
    files.push(target);
    const load = `() => import(${JSON.stringify(source)})`;
    generated += `const [${locals.join(', ')}] = __bcLazyTranslations(${JSON.stringify(locale)}, ${JSON.stringify(target)}, ${load}, ${JSON.stringify(names)});`;
  }
  // 去掉的导入只留下换行，行号不变。
  const edits = [...candidates.keys()].map((node) => ({ start: node.start, end: node.end, text: code.slice(node.start, node.end).replace(/[^\n]/g, '') }));
  edits.push({ start: lastImportEnd, end: lastImportEnd, text: generated });
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += code.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return { code: out + code.slice(cursor), files };
}

/** 开发服务器的插件；放在 `react()` 之后（esbuild 去掉类型之后才改写）。 */
export function lazyLocales(): Plugin[] {
  /** 写了 `i18n-all-locales` 的文件。esbuild 去掉注释之前先记下。 */
  const allLocales = new Set<string>();
  /** 改成按需载入的译文文件。 */
  const lazyFiles = new Set<string>();
  const fileOf = (id: string) => id.replace(/[?#].*$/, '');
  return [
    {
      name: 'baocut:lazy-locales-mark',
      apply: 'serve',
      enforce: 'pre',
      transform(code, id) {
        if (code.includes(ALL_LOCALES_MARK)) allLocales.add(fileOf(id));
        else allLocales.delete(fileOf(id));
      },
    },
    {
      name: 'baocut:lazy-locales',
      apply: 'serve',
      transform(code, id) {
        const file = fileOf(id);
        if (id.startsWith('\0') || file.includes('/node_modules/') || !/\.tsx?$/.test(file) || LOCALE_FILE.test(file) || allLocales.has(file)) return;
        const rewritten = rewriteLocaleImports(code, file);
        if (!rewritten) return;
        for (const target of rewritten.files) lazyFiles.add(target);
        return { code: rewritten.code, map: null };
      },
      // 改了按需载入的译文文件就整页重载：目录模块记着取到的那份（i18n 的 `lazyModules`），热替换换不掉它。
      hotUpdate({ file }) {
        if (this.environment.name !== 'client' || !lazyFiles.has(normalizePath(file))) return;
        this.environment.hot.send({ type: 'full-reload' });
        return [];
      },
    },
  ];
}
