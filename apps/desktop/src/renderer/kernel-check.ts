import { loadRenderPlanner } from '@baocut/ui/preview-kernel';

/** `baocutKernelCheck()` 的结果：内核注入了哪些字体，经内核量出来的一个文字框。 */
export interface KernelCheck {
  fonts: string[];
  box: { width: number; height: number };
}

declare global {
  var baocutKernelCheck: (() => Promise<KernelCheck>) | undefined;
}

/**
 * 渲染进程产物的自检入口（`npm run check:file-fonts`，`tools/check-file-fonts.mjs`）：随产物构建，应用自己不加载它。
 * 检查脚本在 `file://` 下打开真正的 `index.html` 之后动态导入这一份，调 `baocutKernelCheck()`：与预览同一条载入路
 * （同一个模块实例：WASM、按相对地址读全部字体、注入），再经内核量一个文字框。字体有一份读不到，载入就拒绝。
 */
globalThis.baocutKernelCheck = async () => {
  const planner = await loadRenderPlanner();
  const style = { fontSize: 24, fontWeight: 'bold', lineHeight: 1.2 };
  // i18n-ignore: 量字用的样例文字（要含中文，才能量到中文字体）
  const box = planner.measureText('输入文字 BaoCut', style, null, { width: 1920, height: 1080 });
  return { fonts: planner.fontFiles(), box };
};
