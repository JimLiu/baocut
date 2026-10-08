import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import optimizeLocales from '@react-aria/optimize-locales-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { EnvironmentModuleNode, Plugin } from 'vite';
import { LOCALE_TAGS } from '../../packages/protocol/src/i18n.ts';
import { pdfLicenses } from '../../tools/pdf-licenses.ts';
import { thirdPartyNotices } from '../../tools/third-party-notices.ts';
import { s2Styles, s2StylesChunk } from '../../tools/s2-styles.ts';

// 工作区包是 TypeScript 源码（没有构建产物），必须打进 bundle；第三方依赖照常外置。
const bundleWorkspace = { exclude: ['@baocut/runtime', '@baocut/runtime-storage', '@baocut/protocol', '@baocut/ui'] };

/** 界面里存状态的模块：Zustand store 与 Runtime 会话。 */
const STATEFUL = /\/packages\/ui\/src\/(state|runtime)\//;

/**
 * 开发时改到状态模块（或它依赖的模块，如协议包）就整页重载。热替换会让这些模块另起一份空状态，
 * 而已经连着的 Runtime 会话还往旧的那份里写，界面就一直停在「正在整理」之类的载入态。
 */
export function reloadOnStateChange(): Plugin {
  const reachesState = (node: EnvironmentModuleNode, seen: Set<EnvironmentModuleNode>): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (node.file && STATEFUL.test(node.file)) return true;
    return [...node.importers].some((importer) => reachesState(importer, seen));
  };
  return {
    name: 'baocut:reload-on-state-change',
    apply: 'serve',
    hotUpdate({ modules }) {
      if (this.environment.name !== 'client') return;
      const seen = new Set<EnvironmentModuleNode>();
      if (!modules.some((node) => reachesState(node, seen))) return;
      this.environment.hot.send({ type: 'full-reload' });
      return [];
    },
  };
}

/**
 * Runtime 打进 `out/main/runtime.js` 之后在 Node 里同步读编辑语义的 WASM：把 `generated/editor.wasm` 原样放到 bundle 旁边
 * （`out/main/generated/editor.wasm`），`@baocut/editor-wasm` 的 `locateEditorWasm` 先找那里。界面一侧由 Vite 内联，不走这条路。
 * 没有构建 WASM 时只提醒：用到它的流程调用时才报 `EDITOR_WASM_UNAVAILABLE`，与界面一侧一致。
 */
export function shipEditorWasm(): Plugin {
  const source = resolve(import.meta.dirname, '../../packages/editor-wasm/src/generated/editor.wasm');
  return {
    name: 'baocut:ship-editor-wasm',
    apply: 'build',
    generateBundle() {
      if (!existsSync(source)) {
        this.warn(`没有 ${source}，先运行 npm run build:wasm`);
        return;
      }
      this.emitFile({ type: 'asset', fileName: 'generated/editor.wasm', source: readFileSync(source) });
    },
  };
}

/**
 * 预览的字体（`npm run build:wasm` 拷进 `packages/ui/src/render/generated/fonts`）以 `?url` 引入，是 bundle 旁边的单独文件：
 * 打包后的页面在 file:// 下，`new URL(文件名, import.meta.url)` 指到 `out/renderer/assets/` 里的那一份，再由 XHR 读
 * （`preview-wasm.ts`）。构建时核对两件事，不对就让构建失败，不等到打开预览才画不出字：
 * - `base` 是相对的（绝对的 `/assets/…` 在 file:// 下指到磁盘根；electron-vite 的生产构建把它定成 `./`，这里防它变）；
 * - `generated/fonts` 里的每一份都作为资源进了产物。
 */
export function checkPreviewFonts(source = resolve(import.meta.dirname, '../../packages/ui/src/render/generated/fonts')): Plugin {
  let root = '';
  let base = '';
  return {
    name: 'baocut:check-preview-fonts',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      base = config.base;
    },
    generateBundle(_options, bundle) {
      if (base !== '' && !base.startsWith('./')) this.error(`渲染进程的 base 是 ${base}：打包后的 file:// 页面读不到字体，要用相对的 ./`);
      const fonts = existsSync(source) ? readdirSync(source).filter((name) => name.endsWith('.ttf')) : [];
      if (fonts.length === 0) this.error(`${source} 里没有字体，先运行 npm run build:wasm`);
      const shipped = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset') for (const original of output.originalFileNames) shipped.add(resolve(root, original));
      }
      const missing = fonts.filter((name) => !shipped.has(resolve(source, name)));
      if (missing.length > 0) this.error(`预览字体没有进产物：${missing.join('、')}`);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [shipEditorWasm()],
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Runtime 与主进程一起构建，由主进程用 Electron 自带的 Node 启动（ELECTRON_RUN_AS_NODE）。
          runtime: resolve(import.meta.dirname, '../runtime/src/main.ts'),
          // 产物的自检入口（`tools/check-model-assets.mjs` 用 Electron 的 Node 运行）：随应用分发的模型数据解析到哪里；应用自己不加载它。
          'model-assets-check': resolve(import.meta.dirname, 'src/main/model-assets-check.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    // 预览的 WASM 以 `?inline` 引入成 data URL（打包后的 file:// 页面取不了单独的 .wasm 文件）。
    // Vite 默认不把 .wasm 当资源，要明说。
    assetsInclude: ['**/*.wasm', '**/*.bcmap', '**/*.pfb'],
    plugins: [
      // S2 的 style 宏必须最先处理（开发时另把 S2 样式合并去重，见 tools/s2-styles.ts）。
      ...s2Styles(),
      pdfLicenses(resolve(import.meta.dirname, '../..')),
      thirdPartyNotices(resolve(import.meta.dirname, '../..')),
      react(),
      { ...optimizeLocales.vite({ locales: Object.values(LOCALE_TAGS) }), enforce: 'pre' },
      reloadOnStateChange(),
      checkPreviewFonts(),
    ],
    build: {
      target: 'es2022',
      // electron-vite 给渲染进程默认 minify: false，CSS 跟着不压缩，style 宏给每份 CSS 附的内联 source map（含整份源文件）
      // 就原样进了产物（三十多 MB）。CSS 照 Web 客户端一样压缩，注释连同 source map 一起去掉；JS 仍按 electron-vite 的默认不压缩。
      cssMinify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          // 产物的自检入口（`tools/check-file-fonts.mjs` 在 file:// 下动态导入）；应用自己不加载它。
          'kernel-check': resolve(import.meta.dirname, 'src/renderer/kernel-check.ts'),
          // 预览播放的端到端基准（`tools/preview-bench.mjs` 同样动态导入）；应用自己不加载它。
          'preview-bench': resolve(import.meta.dirname, 'src/renderer/preview-bench.ts'),
        },
        output: {
          // S2、S2 AI 组件与 style 宏生成的 CSS 合成一个文件，避免按 chunk 拆开后的层叠顺序问题。
          manualChunks: s2StylesChunk,
        },
      },
    },
  },
});
