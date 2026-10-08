/**
 * 代码包运行时（架构设计 §8、§13.1 `code-runtime`）：浏览器合成的导入验证、离屏执行、取帧与烘焙。
 *
 * - `bundle-inspect.ts`：读目录、拒绝符号链接与白名单外的文件、算 `contentHash`、校验或合成清单、静态扫描网络引用。
 * - `composition-host.ts`：Electron 离屏窗口的宿主进程（JSON 行子进程），拦截一切非 `file:` / `data:` 请求。
 * - `composition-adapter.ts`：两种作者合同（`baocut/1`、`hyperframes/1`）在页面里的统一取帧脚本。
 * - `bundle-verify.ts`：代码包规范 §6.2 的验证项，产出 `CodeBundleVerificationReport`。
 * - `composition-bake.ts`：按输出帧率逐帧取 PNG，经 ffmpeg 封成带 alpha 的 QuickTime，产出 `BakeRecord` 的素材侧字段。
 */

export {
  CodeBundleError,
  computeContentHash,
  inspectBundle,
  listBundleFiles,
  scanNetworkReferences,
  synthesizeManifest,
  parseRate,
  readRootAttributes,
  toRate,
  type BundleLimits,
  type InspectBundleOptions,
  type InspectedBundle,
  type ListBundleFilesOptions,
  type NetworkReference,
  type SynthesizeManifestInput,
  type SynthesizeOverrides,
} from './bundle-inspect.ts';
export {
  CompositionHost,
  frameTicketAt,
  intrinsicMismatches,
  resolveElectronBinary,
  type CompositionHostOptions,
  type CompositionPage,
  type CompositionSession,
  type OpenSessionOptions,
  type RenderedFrame,
} from './composition-host.ts';
export { COMPOSITION_ADAPTER_SCRIPT, type AdapterPageInfo } from './composition-adapter.ts';
export { verifyBundle, type VerifyBundleOptions } from './bundle-verify.ts';
export { bakeComposition, ffprobePathFor, resolveFfmpeg, type BakeOptions, type BakeResult } from './composition-bake.ts';
