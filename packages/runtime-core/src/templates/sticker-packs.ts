import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RpcError,
  STICKER_PACK_ORIGIN,
  packSticker,
  type MediaHandle,
  type PackSticker,
  type StickerApplyParams,
  type StickerApplyResult,
} from '@baocut/protocol';
import { RcCommon, RcStickers } from '@baocut/protocol/messages/runtime-core';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { VideoService } from '../videos/video-service.ts';

/**
 * 找随包贴纸的目录（仓库根的 `stickers/`，仓库约定 §2）：`BAOCUT_STICKERS_DIR` 环境变量；打包后的应用里是
 * `<resources>/stickers`；开发时从本模块往上找同时有 `package.json` 与 `stickers/` 的目录（仓库根）。都没有时 null。
 */
export function resolveStickerPacksDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_STICKERS_DIR) return env.BAOCUT_STICKERS_DIR;
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, 'stickers');
    if (isDirectory(bundled)) return bundled;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, 'stickers');
    if (fs.existsSync(path.join(dir, 'package.json')) && isDirectory(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export interface StickerPacksOptions {
  /** `resolveStickerPacksDir` 的结果；null 表示这份应用没有带贴纸。 */
  dir: string | null;
  videos: VideoService;
}

/**
 * 随包贴纸（`stickers.*`）：目录在 `@baocut/protocol` 的 `sticker-packs.ts`，字节在应用的 `stickers/`。只读：句柄只发给
 * 目录里的贴纸；拷进视频是一笔普通的编辑事务（`importAsset`，`managed`），之后与应用里的那份无关。
 */
export class StickerPacks {
  readonly #options: StickerPacksOptions;

  constructor(options: StickerPacksOptions) {
    this.#options = options;
  }

  /** 贴纸在磁盘上的位置。目录里没有这个 ID、或应用没带贴纸时 `not-found`。 */
  locate(id: string): { sticker: PackSticker; root: string; file: string } {
    const sticker = packSticker(id);
    if (!sticker) throw new RpcError('not-found', RcStickers.stickerNotFound({ id }), { code: 'STICKER_NOT_FOUND' });
    const root = this.#options.dir;
    if (!root || !fs.existsSync(path.join(root, sticker.path))) {
      throw new RpcError('not-found', RcStickers.stickersMissing(), { code: 'STICKER_NOT_FOUND' });
    }
    return { sticker, root, file: sticker.path };
  }

  /** 句柄由调用方所在通道的媒体表发：桌面网关与 Web 服务各有一张，Web 页面只能取同源的 `/media/…`。 */
  openHandle(p: { id: string }, media: MediaRegistry): Promise<MediaHandle> {
    const { root, file } = this.locate(p.id);
    return media.issue(root, file);
  }

  async applyToVideo(p: StickerApplyParams, principal: TrustedPrincipal): Promise<StickerApplyResult> {
    const { videos } = this.#options;
    const { sticker, root, file } = this.locate(p.id);
    const expectedRevision = p.expectedRevision ?? videos.mirror(p.videoId)?.video.revision;
    if (expectedRevision === undefined) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const name = p.name ?? sticker.id;
    const result = await videos.apply(
      {
        videoId: p.videoId,
        commandId: p.commandId,
        expectedRevision,
        operations: [
          {
            type: 'importAsset',
            path: path.join(root, file),
            name,
            ref: 'asset',
            storage: 'managed',
            provenance: { origin: STICKER_PACK_ORIGIN, source: { stickerPack: { id: sticker.id } } },
          },
        ],
        label: RcStickers.addStickerLabel({ name }).text,
      },
      principal,
    );
    const assetId = result.receipt.refs?.asset;
    if (!assetId) throw new RpcError('internal', RcStickers.stickerNotFound({ id: sticker.id }));
    return { ...result, assetId };
  }
}
