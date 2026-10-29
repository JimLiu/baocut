/**
 * 设计稿编辑器页面的入口（`@baocut/design/editor`）：apps/design-editor 的 main.ts 先调 installDesignEditorHost
 * 装好 globalThis.designHost，再启动设计稿运行时（运行时启动时就读宿主能力）。docs/design/canvas §4、§5。
 *
 * 宿主对象由幻灯片编辑器的 connectEditorHost 做：文件、素材、外部改动走同源 HTTP（`_files.json`、`__deck/*`），
 * 与父窗口的消息也是同一套（packages/slides/src/editor-messages.ts）。设计稿另加 `downloads`（导出的文件交给父窗口保存），
 * 并让运行时自己的 frame 协议信任父窗口，BaoCut 由此问它能导出哪些格式、要它导出整份设计稿（§8.3）。
 * 页面单独打开时，`downloads` 直接交给浏览器下载，整份导出由编辑器右上角工具栏的「Export」按钮发起。
 */
import { connectEditorHost, windowParentLink } from '@baocut/slides/editor';
import { createBrowserDownloads, createDownloadsBridge } from './downloads-bridge.ts';

export type * from './design-host.ts';
export { createBrowserDownloads, createDownloadsBridge, type DownloadsBridge } from './downloads-bridge.ts';

export interface InstallDesignEditorHostOptions {
  /** 编辑器页面的地址（以 / 结尾），路由都相对它。默认是页面所在目录。 */
  base?: string;
  win?: Window & typeof globalThis;
}

/** 运行时启动时读的页面声明（platform/frame-host-bridge.tsx）。 */
interface FramePreamble {
  origins?: string[];
  trustParent?: boolean;
}

/** 在页面上装好 globalThis.designHost（设计稿编辑器）。 */
export function installDesignEditorHost(options: InstallDesignEditorHostOptions = {}): void {
  const win = options.win ?? window;
  const host = connectEditorHost({ base: options.base, win });
  const link = windowParentLink(win);
  if (!link) {
    // 页面单独打开（不在 BaoCut 的 iframe 里）：没有父窗口可交，导出的文件直接交给浏览器下载
    win.designHost = { ...host, downloads: createBrowserDownloads(win) };
    return;
  }
  // 桌面端的父页面是 file://（origin 为 null），按 origin 认不了，与 editor-messages 一样按 window.parent 认
  const page = win as unknown as { __FRAME_PREAMBLE?: FramePreamble };
  page.__FRAME_PREAMBLE = { ...page.__FRAME_PREAMBLE, trustParent: true };
  win.designHost = { ...host, downloads: createDownloadsBridge(link).capability };
}
