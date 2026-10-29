/**
 * 设计稿运行时（@baocut/design-runtime）从 globalThis.designHost 读取的宿主能力（docs/design/canvas §4）。
 * 原运行时读 globalThis.claude；移植时把这些读取点都改成了 designHost，每处带 `BaoCut:` 注释。
 *
 * 宿主对象与幻灯片编辑器是同一个（@baocut/slides/editor 的 connectEditorHost），所以形状就是 SlidesHost。
 * 各能力在运行时里的读取点（路径相对 packages/design-runtime/src）：
 *   artifact / self  platform/design-files-port.ts、platform/publish.ts、platform/document-store.ts（publish 批量写文件，带 ifMatch）
 *   user             platform/user-capabilities.ts（id / canEdit / can / profiles；不提供 me，运行时当作取不到当前用户的资料）
 *   assets           platform/image-upload.ts（粘贴、拖入的图片与字体，返回 /_blob/<id>）
 *   comments         comments/host-controller.ts（customAnchors：运行时算锚点，宿主弹批注框）
 *   chat             canvas/claude-handoff.tsx（「交给智能体」的提示放进会话的输入框）
 *   downloads        export/downloads.tsx 的 saveThroughHost（导出的文件交给父窗口保存；页面单独打开时交给浏览器下载，downloads-bridge.ts）
 * 不提供（运行时都有兜底，见 packages/design-runtime/README.md）：
 *   use       按名字异步取能力；没有时 platform/host-capabilities.ts 直接读上面的字段，不等待
 *   sample    快速编辑要宿主代为调用模型（fast-edit/sampling-capability.ts）；功能开关里快速编辑也是关的
 *   db、room  旧的数据库存储与多人在线（platform/database-adapter.ts）；运行时按文件模式、单用户工作
 *   hot       外部改动就地应用（platform/hot-reload.ts）；BaoCut 改为先发布未保存的改动再重新载入
 *   commentLabels 只有幻灯片运行时会问
 */
import type { SlidesHost } from '@baocut/slides/editor';
import type { HostDownloadsCapability } from './downloads-bridge.ts';

export type { HostDownloadsCapability, HostSaveFile } from './downloads-bridge.ts';

export type DesignHost = Omit<SlidesHost, 'commentLabels' | 'use'> & { downloads?: HostDownloadsCapability };

declare global {
  // eslint-disable-next-line no-var -- 全局变量只能用 var 声明
  var designHost: DesignHost | undefined;
}
