import { resolve } from 'node:path';
import optimizeLocales from '@react-aria/optimize-locales-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { LOCALE_TAGS } from '../../packages/protocol/src/i18n.ts';
import { pdfLicenses } from '../../tools/pdf-licenses.ts';
import { thirdPartyNotices } from '../../tools/third-party-notices.ts';
import { s2Styles, s2StylesChunk } from '../../tools/s2-styles.ts';

/**
 * Web 客户端（架构设计 §4.8）：与桌面渲染进程同一套界面包与同样的 Vite 插件，产物是静态文件，
 * 由 Runtime 的 Web 服务在回环端口上提供（`npm run build:web`）。
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  // 页面只由 Web 服务在站点根路径提供。
  base: '/',
  // 预览的 WASM 以 `?inline` 引入成 data URL。Vite 默认不把 .wasm 当资源，要明说。
  assetsInclude: ['**/*.wasm', '**/*.bcmap', '**/*.pfb'],
  plugins: [
    // S2 的 style 宏必须最先处理（开发时另把 S2 样式合并去重，见 tools/s2-styles.ts）。
    ...s2Styles(),
    pdfLicenses(resolve(import.meta.dirname, '../..')),
    thirdPartyNotices(resolve(import.meta.dirname, '../..')),
    react(),
    { ...optimizeLocales.vite({ locales: Object.values(LOCALE_TAGS) }), enforce: 'pre' },
  ],
  build: {
    target: 'es2022',
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // S2、S2 AI 组件与 style 宏生成的 CSS 合成一个文件，避免按 chunk 拆开后的层叠顺序问题。
        manualChunks: s2StylesChunk,
      },
    },
  },
});
