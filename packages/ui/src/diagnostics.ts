// 诊断与基准的入口（`npm run bench:preview` 的页面一侧，`apps/desktop/src/renderer/preview-bench.ts`）：随产物构建、应用自己不加载，
// 与应用共用同一份模块实例，所以能从页面上的预览画布找到它的引擎、经外壳打开视频。
export { useShell } from './state/shell-store.ts';
export { previewEngineOf, type PlaybackStats } from './components/editor/preview-engine.ts';
export type { StallReport } from './components/editor/preview-watch.ts';
