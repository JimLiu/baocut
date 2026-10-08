import path from 'node:path';
import { RpcError, newId, type Id, type RpcErrorCode, type VideoChange, type VideoOpenResult } from '@baocut/protocol';
import { RcVideo } from '@baocut/protocol/messages/runtime-core';
import type { Harness } from '@baocut/harness';
import type { RpcHandlers } from '../handlers.ts';
import type { MediaRegistry } from '../media.ts';
import type { VideoService } from '../videos/video-service.ts';
import { ToolError } from '../agent-tools/tool-catalog.ts';
import { framesDirectory } from '../agent-tools/video-frames.ts';
import { videoChangeOf, type CompositionCaller, type CompositionService } from './composition-service.ts';

type CompositionMethod = 'compositions.preview' | 'compositions.import';

export interface CompositionMethodDeps {
  compositions: CompositionService;
  videos: VideoService;
  harness: Harness;
  /** 帧的读取句柄：Web 服务用它自己的（同源地址、要会话）。 */
  media: MediaRegistry;
}

/**
 * `compositions.*` 的处理函数（架构设计 §8），由 `handlers.ts` 并进方法表。保留给界面，目前没有界面调用；与工具
 * `compositions_preview` / `compositions_import` 共用 `CompositionService`（参数相同，含 `replace`）：
 *
 * - 视频要已经打开（与 `edits.apply` 相同）；`path` 相对视频的来源目录（项目目录，或不属于项目的会话的工作目录），按真实路径
 *   只能在它里面——桌面界面与 Web 服务同一条规则；预览帧写在来源目录的 `.baocut-out/frames/<videoId>/`（与智能体的同一个位置），
 *   返回媒体句柄。
 * - 写入的操作者是连接的主体（界面与浏览器是 `user_local`），不经 BaoCut 的审批；给了 `conversationId` 时每笔修改在会话里放
 *   一张变更卡（界面发起的 `edits.apply` 不放卡，这里是界面替用户导入了一段代码画面，要在会话里留下回执）。
 * - 服务抛出的 `ToolError` 换成 `RpcError`：文字是目录里的「导入 / 预览失败（错误码）」，错误码、原话、`next` 与验证项放进 `details`。
 */
export function compositionMethods(deps: CompositionMethodDeps): Pick<RpcHandlers['methods'], CompositionMethod> {
  const { compositions, videos, harness, media } = deps;

  const open = async (videoId: Id): Promise<VideoOpenResult> => {
    const ref = videos.ref(videoId);
    const snapshot = videos.mirror(videoId);
    if (!ref || !snapshot) throw new RpcError('not-found', RcVideo.videoNotOpenOpenFirst(), { code: 'VIDEO_NOT_OPEN' });
    return { ref, snapshot };
  };
  /** 视频的来源目录：所属项目的目录，或不属于项目的会话的工作目录。 */
  const sourceRoot = (opened: VideoOpenResult): string => {
    const { projectId, conversationId } = opened.ref.source;
    if (projectId) {
      const project = harness.listProjects().find((p) => p.id === projectId);
      if (project) return project.path;
    } else if (conversationId) {
      return harness.getConversation(conversationId).conversation.cwd;
    }
    throw new RpcError('not-found', RcVideo.videoNotInSourceDir(), { code: 'VIDEO_NOT_IN_SOURCE_DIR' });
  };
  const caller = (videoId: Id): CompositionCaller => ({
    open: () => open(videoId),
    importBase: (opened) => {
      const root = sourceRoot(opened);
      return { cwd: root, confine: root };
    },
  });

  return {
    'compositions.preview': async (p) => {
      const preview = await rpcErrors('preview', () =>
        compositions.preview(p, {
          ...caller(p.video),
          framesDir: (opened) => {
            const root = sourceRoot(opened);
            return framesDirectory(root, opened.ref.videoId, root);
          },
        }),
      );
      const frames = await Promise.all(
        preview.frames.map(async (frame) => ({
          at: frame.at,
          sampledSeconds: frame.sampledSeconds,
          clamped: frame.clamped,
          sha256: frame.sha256,
          width: preview.width,
          height: preview.height,
          media: await media.issue(path.dirname(frame.file), path.basename(frame.file)),
        })),
      );
      return { ...preview, frames };
    },

    'compositions.import': async ({ conversationId, ...args }, principal) => {
      // 先认会话：坏的 ID 不要等烘焙完才发现。
      if (conversationId !== undefined) harness.getConversation(conversationId);
      return rpcErrors('import', () =>
        compositions.import(args, {
          ...caller(args.video),
          confirm: async () => {},
          apply: async (opened, edit) => {
            const result = await videos.apply(
              {
                videoId: opened.ref.videoId,
                commandId: edit.commandId ?? newId('cmd'),
                expectedRevision: edit.expectedRevision,
                operations: edit.operations as never,
                label: edit.label,
              },
              principal,
            );
            if (conversationId !== undefined) {
              const change: VideoChange = videoChangeOf(videos, opened, result);
              const target =
                'conversationId' in change.target && !change.target.conversationId ? { ...change.target, conversationId } : change.target;
              harness.recordVideoChange(conversationId, null, { ...change, target });
            }
            return result;
          },
        }),
      );
    },
  };
}

/** 工具错误的错误码 → RPC 的错误种类；没列出的（代码包与参数的问题）是 `invalid-request`。 */
const RPC_CODES: Readonly<Record<string, RpcErrorCode>> = {
  COMPOSITION_HOST_UNAVAILABLE: 'unsupported',
  COMPOSITION_BAKE_FAILED: 'unsupported',
  ASSET_NOT_FOUND: 'not-found',
  PATH_OUTSIDE_PROJECT: 'forbidden',
  PROJECT_REVISION_CONFLICT: 'conflict',
};

/** 服务的 `ToolError` 换成 `RpcError`；`RpcError`（视频没打开、引擎的错误）原样抛出。 */
async function rpcErrors<T>(action: 'import' | 'preview', run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof ToolError)) throw error;
    const code = error.code;
    const message = action === 'import' ? RcVideo.compositionImportFailed({ code }) : RcVideo.compositionPreviewFailed({ code });
    throw new RpcError(RPC_CODES[code] ?? 'invalid-request', message, { ...error.extra, code, detail: error.message });
  }
}
