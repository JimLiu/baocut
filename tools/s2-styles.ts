// 渲染进程（Electron）与 Web 客户端共用的 S2 样式装配：style 宏插件、S2 样式的去重，以及生产构建把 S2 样式合成一块的规则。
//
// style 宏每处调用各生成一份 CSS（`macro-<内容哈希>.css`，带这处调用的位置与内联 source map），S2 的组件也各带一份 CSS。
// 原子类在这些文件里大量重复：开发时 Vite 给每份各插一个 <style>，两千多张样式表、三万多条规则里只有几千条不同；
// 生产构建把它们合进 s2-styles 一块，压缩也不去重，两万多条规则里同样只有两千多条不同。每次样式计算都要把它们过一遍。
// 两边都按 `s2-styles-merge.ts` 合并去重、层叠结果不变：开发时由 `s2-styles-client.ts` 合进一张样式表，
// 生产构建在产物写出前改写 s2-styles 那一份。

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import macros from 'unplugin-parcel-macros';
import { normalizePath, type Plugin } from 'vite';
import { mergeLayeredCss, parseLayeredCss } from './s2-styles-merge.ts';

/** 生产构建合成一块（s2-styles）的 CSS：style 宏生成的，以及 S2、S2 AI 组件自带的。 */
export function s2StylesChunk(id: string): string | undefined {
  if (/macro-(.*)\.css$/.test(id) || /@react-spectrum\/(s2|ai)\/.*\.css$/.test(id)) return 's2-styles';
}

/** style 宏插件，加上开发时与生产构建的样式去重；放在插件列表最前（宏必须先于其他插件处理源码）。 */
export function s2Styles(): Plugin[] {
  const macroPlugin = macros.vite() as Plugin;
  return [dedupeS2StylesInDev(macroPlugin), macroPlugin, dedupeS2StylesInBuild()];
}

/**
 * 生产构建：产物写出前把 s2-styles 那一份 CSS 合并去重（已经压缩过的照样保持压缩）。文件名里的哈希是去重前算的，
 * 去重只由内容决定，同样的输入仍得到同样的文件名与内容。拆不准时原样保留并提醒。
 */
function dedupeS2StylesInBuild(): Plugin {
  return {
    name: 'baocut:s2-styles-build',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'asset' || !/(^|\/)s2-styles-[^/]*\.css$/.test(output.fileName)) continue;
          const css = typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
          const parsed = parseLayeredCss(css);
          if (parsed) output.source = mergeLayeredCss([parsed], '');
          else this.warn(`${output.fileName} 里有拆不准的写法（匿名层、@import 或条件规则里的 @layer），没有去重`);
        }
      },
    },
  };
}

const MACRO_CSS = /^macro-[0-9a-f]{64}\.css$/;
/** S2、S2 AI 组件自带的 CSS（预构建的依赖以绝对路径引入）。page.css 是 :root 上的页面样式，不分层，留在原位与 app.css 保持先后。 */
const COMPONENT_CSS = /\/@react-spectrum\/(s2|ai)\/.+\.css$/;
const PAGE_CSS = /\/@react-spectrum\/s2\/page\.css$/;
/**
 * 虚拟模块的 id：不以 .css 结尾，Vite 的 CSS 插件就不会接手，按 JS 模块处理；以 / 开头且不带 \0，
 * Vite 发修剪通知用的地址才与模块里 import.meta.hot 的地址一致（`\0…` 与裸名的 id 两边一个包了 /@id/、一个没包，修剪回调收不到）。
 */
const PREFIX = '/@baocut-s2-style/';
// 用 import.meta.url 而不是 import.meta.dirname：electron-vite 打包配置文件时只按文件替换前者，后者会变成配置文件所在的目录。
const CLIENT = normalizePath(fileURLToPath(new URL('./s2-styles-client.ts', import.meta.url)));
const MERGE = normalizePath(fileURLToPath(new URL('./s2-styles-merge.ts', import.meta.url)));

/**
 * 开发时把 style 宏与 S2 组件的 CSS 交给 `s2-styles-client.ts` 合并去重，而不是各插一个 <style>：
 * 每份 CSS 变成一个 JS 模块，载入时登记它的规则，不再被引用时（热更新后 Vite 修剪掉）注销。
 * 宏的 CSS 里附带的内联 source map（整份源文件）去掉，开发者工具里这些规则不再映射回源码行；静态样式仍带 `-macro-static-*` 的位置信息。
 */
function dedupeS2StylesInDev(macroPlugin: Plugin): Plugin {
  const loadMacroCss = macroPlugin.load as (this: unknown, id: string) => string;
  const hasMacroCss = (macroPlugin as unknown as { loadInclude: (id: string) => boolean }).loadInclude;
  /**
   * 见过的宏 CSS（去掉 source map），按文件名记。宏插件重新转换一个文件时先删掉它上次生成的全部 CSS、转换完再重新登记，
   * 而内容相同的 CSS 在各文件之间共用一个文件名：这段空当里别的文件解析同名的 CSS 就找不到（依赖预构建完整页重载、
   * 许多文件同时重新转换时每次都会撞上）。文件名是内容的哈希，记下的内容不会过时。
   */
  const seen = new Map<string, string>();
  const macroCss = (context: unknown, id: string): string | undefined => {
    if (!seen.has(id) && hasMacroCss(id)) {
      seen.set(id, loadMacroCss.call(context, id).replace(/\n\/\*# sourceMappingURL=[^*]*\*\/\s*$/, ''));
    }
    return seen.get(id);
  };
  return {
    name: 'baocut:s2-styles-dev',
    apply: 'serve',
    enforce: 'pre',
    // `@react-spectrum/s2/style` 只给 style 宏在 Node 里用（导出只有 node 条件），依赖扫描按浏览器条件解析不了它，
    // 整个扫描就失败：预构建推迟到页面载入时，发现依赖后再整页重载一次。扫描时跳过它。
    config: () => ({ optimizeDeps: { exclude: ['@react-spectrum/s2/style'] } }),
    // 改到去重本身（登记表在页面里只有一份）就整页重载：热替换会另起一份空的登记表，已经登记过的样式回不来。
    hotUpdate({ file }) {
      if (file !== CLIENT && file !== MERGE) return;
      this.environment.hot.send({ type: 'full-reload' });
      return [];
    },
    resolveId(source) {
      if (source.startsWith(PREFIX)) return source;
      if (MACRO_CSS.test(source)) {
        // 宏插件那边没有、也没见过这份时交还给它，报错与原来一样。
        if (macroCss(this, source) === undefined) return;
        return PREFIX + source.slice(0, -'.css'.length);
      }
      if (isAbsolute(source) && COMPONENT_CSS.test(source) && !PAGE_CSS.test(source)) {
        return `${PREFIX}fs/${source.replace(/^\//, '').slice(0, -'.css'.length)}`;
      }
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return;
      const rest = id.slice(PREFIX.length);
      // 组件 CSS 的绝对路径：POSIX 的去掉了开头的 /，Windows 的以盘符开头。
      const file = rest.startsWith('fs/') ? rest.slice('fs/'.length) : null;
      const source = (file === null ? rest : /^[A-Za-z]:\//.test(file) ? file : `/${file}`) + '.css';
      let css: string;
      if (MACRO_CSS.test(source)) {
        const content = macroCss(this, source);
        if (content === undefined) return this.error(`style 宏没有生成 ${source}`);
        css = content;
      } else {
        css = readFileSync(source, 'utf8');
      }
      return [
        `import { addStyle, removeStyle } from ${JSON.stringify(CLIENT)};`,
        `const id = ${JSON.stringify(source)};`,
        `addStyle(id, ${JSON.stringify(css)});`,
        'if (import.meta.hot) {',
        '  import.meta.hot.accept();',
        '  import.meta.hot.prune(() => removeStyle(id));',
        '}',
      ].join('\n');
    },
  };
}
