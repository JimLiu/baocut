import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLIED_ASSET_REF,
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
import type { OnlineAsset, OnlineAssets } from '../online-assets.ts';
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
  /** 动态贴纸不随包，从素材 CDN 取（`stickers/anim/<ID>`）；null 时只用 `dir` 里有的。 */
  online: OnlineAssets | null;
  videos: VideoService;
}

/** 动态贴纸的清单（随包的 `anim/provenance.json`）里每个文件的大小与 sha256。 */
type AnimatedManifest = Record<string, { bytes: number; sha256: string }>;

/**
 * 随包贴纸（`stickers.*`）：目录在 `@baocut/protocol` 的 `sticker-packs.ts`。静态贴纸的字节在应用的 `stickers/`；动态贴纸
 * 只带清单（`anim/provenance.json`），字节用到时从素材 CDN 取进本机缓存（`OnlineAssets`），开发时仓库里有就直接用。
 * 只读：句柄只发给目录里的贴纸；拷进视频是一笔普通的编辑事务（`importAsset`，`managed`；调用方给的 `operations` 接在
 * 后面，一步撤销），之后与应用里、缓存里的那份无关。
 */
export class StickerPacks {
  readonly #options: StickerPacksOptions;
  #manifest: AnimatedManifest | null = null;

  constructor(options: StickerPacksOptions) {
    this.#options = options;
  }

  /**
   * 贴纸在磁盘上的位置。目录里没有这个 ID、或应用没带贴纸时 `not-found`；动态贴纸本地没有时先下载，下不来时是
   * `ONLINE_ASSET_UNAVAILABLE`。
   */
  async locate(id: string): Promise<{ sticker: PackSticker; root: string; file: string }> {
    const sticker = packSticker(id);
    if (!sticker) throw new RpcError('not-found', RcStickers.stickerNotFound({ id }), { code: 'STICKER_NOT_FOUND' });
    const root = this.#options.dir;
    const missing = () => new RpcError('not-found', RcStickers.stickersMissing(), { code: 'STICKER_NOT_FOUND' });
    if (!root) throw missing();
    if (fs.existsSync(path.join(root, sticker.path))) return { sticker, root, file: sticker.path };
    const entry = sticker.animated ? this.#animatedManifest(root)?.[sticker.id] : undefined;
    const online = this.#options.online;
    if (!entry || !online) throw missing();
    const asset: OnlineAsset = { path: `stickers/${sticker.path}`, bytes: entry.bytes, sha256: entry.sha256 };
    await online.ensure(asset);
    return { sticker, root: online.cacheDir, file: asset.path };
  }

  #animatedManifest(root: string): AnimatedManifest | null {
    if (!this.#manifest) {
      try {
        this.#manifest = JSON.parse(fs.readFileSync(path.join(root, 'anim', 'provenance.json'), 'utf8')) as AnimatedManifest;
      } catch {
        return null;
      }
    }
    return this.#manifest;
  }

  /** 句柄由调用方所在通道的媒体表发：桌面网关与 Web 服务各有一张，Web 页面只能取同源的 `/media/…`。 */
  async openHandle(p: { id: string }, media: MediaRegistry): Promise<MediaHandle> {
    const { root, file } = await this.locate(p.id);
    return media.issue(root, file);
  }

  async applyToVideo(p: StickerApplyParams, principal: TrustedPrincipal): Promise<StickerApplyResult> {
    const { videos } = this.#options;
    const { sticker, root, file } = await this.locate(p.id);
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
            ref: APPLIED_ASSET_REF,
            storage: 'managed',
            provenance: { origin: STICKER_PACK_ORIGIN, source: { stickerPack: { id: sticker.id } } },
          },
          ...(p.operations ?? []),
        ],
        ...(p.label !== undefined
          ? { label: p.label, ...(p.labelRef ? { labelRef: p.labelRef } : {}) }
          : { label: RcStickers.addStickerLabel({ name }).text }),
      },
      principal,
    );
    const assetId = result.receipt.refs?.[APPLIED_ASSET_REF];
    if (!assetId) throw new RpcError('internal', RcStickers.stickerNotFound({ id: sticker.id }));
    return { ...result, assetId };
  }
}
