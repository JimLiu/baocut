import fs from 'node:fs/promises';
import path from 'node:path';
import {
  APPLIED_ASSET_REF,
  CODEX_PET_ORIGIN,
  RpcError,
  communityPet,
  communityPetPreviewUrl,
  communityPetSheetUrl,
  communityPetThumbnailUrl,
  type MediaHandle,
  type PetApplyParams,
  type PetApplyResult,
  type PetHandleParams,
  type PetRef,
} from '@baocut/protocol';
import { RcCommon, RcStickers } from '@baocut/protocol/messages/runtime-core';
import { sha256File } from '../external-tools/tool-download.ts';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { OnlineAssets } from '../online-assets.ts';
import type { VideoService } from '../videos/video-service.ts';

export interface CodexPetsOptions {
  /** 本机缓存的根用它的（`<cacheDir>/pets/…`）。 */
  online: OnlineAssets;
  videos: VideoService;
  /** 测试用：替换取社区文件的 `fetch`。 */
  fetch?: typeof fetch;
  /** 一个社区文件最多取多久（默认 1 分钟）。 */
  timeoutMs?: number;
}

/** 社区文件的上限：图集都在 3 MiB 以内，留足余量。 */
const MAX_COMMUNITY_BYTES = 16 << 20;

interface ResolvedPet {
  /** 素材的缺省名字。 */
  name: string;
  /** 记进素材来源的 `source.codexPet`。 */
  source: Record<string, string | number>;
  /** 图集在本机的绝对路径（必要时先取下来）与它的 sha256。 */
  sheet: () => Promise<{ file: string; sha256: string }>;
}

/**
 * Codex Pets（`pets.*`）：目录在 `@baocut/protocol` 的 `pets.ts`，都是社区 pet。图集与缩略图从上游（awesome-codex-pet
 * 与它的站点）取，没有清单可对，只认目录里有的 slug、WebP 文件头与大小上限。存进本机缓存
 * （`<home>/cache/online-assets/pets/`），之后离线也能用。
 * 贴进视频前由引擎把待机那一行编成循环 APNG（`pets/idle/<图集 sha256>.apng`，同一张图集只编一次），再拷进视频：
 * 一笔普通的编辑事务（`importAsset`，`managed`；调用方给的 `operations` 接在后面，一步撤销）。
 */
export class CodexPets {
  readonly #options: CodexPetsOptions;
  readonly #pending = new Map<string, Promise<string>>();

  constructor(options: CodexPetsOptions) {
    this.#options = options;
  }

  get #cacheDir(): string {
    return this.#options.online.cacheDir;
  }

  #resolve(ref: PetRef): ResolvedPet {
    const pet = communityPet(ref.slug);
    if (!pet) throw new RpcError('not-found', RcStickers.petNotFound({ id: ref.slug }), { code: 'PET_NOT_FOUND' });
    return {
      name: pet.name,
      source: { source: 'community', slug: pet.slug, name: pet.name, author: pet.author, license: pet.license, version: pet.version },
      sheet: async () => {
        const file = await this.#community(pet.slug, 'spritesheet.webp', communityPetSheetUrl(pet.slug));
        return { file, sha256: await sha256File(file) };
      },
    };
  }

  /** 社区文件在缓存里的绝对路径：有就直接用，没有时从上游取。取不下来、不是 WebP 或太大时 `ONLINE_ASSET_UNAVAILABLE`。 */
  #community(slug: string, name: string, url: string): Promise<string> {
    const relative = `pets/community/${slug}/${name}`;
    const pending = this.#pending.get(relative);
    if (pending) return pending;
    const file = path.join(this.#cacheDir, ...relative.split('/'));
    const task = this.#download(url, file, relative).finally(() => this.#pending.delete(relative));
    this.#pending.set(relative, task);
    return task;
  }

  async #download(url: string, file: string, relative: string): Promise<string> {
    if ((await fs.stat(file).catch(() => null))?.isFile()) return file;
    try {
      const response = await (this.#options.fetch ?? fetch)(url, { signal: AbortSignal.timeout(this.#options.timeoutMs ?? 60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_COMMUNITY_BYTES) throw new Error('the file is too large');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_COMMUNITY_BYTES) throw new Error('the file is too large');
      if (!isWebp(bytes)) throw new Error('not a WebP image');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const part = `${file}.part`;
      await fs.writeFile(part, bytes);
      await fs.rename(part, file);
      return file;
    } catch (error) {
      throw new RpcError(
        'internal',
        RcStickers.onlineAssetUnavailable({ reason: error instanceof Error ? error.message : String(error) }),
        { code: 'ONLINE_ASSET_UNAVAILABLE', path: relative },
      );
    }
  }

  /** 句柄由调用方所在通道的媒体表发（同 `stickers.openHandle`）。 */
  async openHandle(p: PetHandleParams, media: MediaRegistry): Promise<MediaHandle> {
    const pet = this.#resolve(p.pet);
    const { slug } = p.pet;
    const file =
      p.file === 'sheet'
        ? (await pet.sheet()).file
        : p.file === 'thumbnail'
          ? await this.#community(slug, 'thumbnail.webp', communityPetThumbnailUrl(slug))
          : await this.#community(slug, 'idle.webp', communityPetPreviewUrl(slug));
    return media.issue(this.#cacheDir, path.relative(this.#cacheDir, file));
  }

  /** 待机那一行的 APNG：同一张图集（按 sha256）只编一次。 */
  async idleAnimation(ref: PetRef): Promise<string> {
    const { file, sha256 } = await this.#resolve(ref).sheet();
    const relative = `pets/idle/${sha256}.apng`;
    const pending = this.#pending.get(relative);
    if (pending) return pending;
    const out = path.join(this.#cacheDir, ...relative.split('/'));
    const task = (async () => {
      if (!(await fs.stat(out).catch(() => null))?.isFile()) await this.#options.videos.petIdleApng(file, out);
      return out;
    })().finally(() => this.#pending.delete(relative));
    this.#pending.set(relative, task);
    return task;
  }

  async applyToVideo(p: PetApplyParams, principal: TrustedPrincipal): Promise<PetApplyResult> {
    const { videos } = this.#options;
    const pet = this.#resolve(p.pet);
    const file = await this.idleAnimation(p.pet);
    const expectedRevision = p.expectedRevision ?? videos.mirror(p.videoId)?.video.revision;
    if (expectedRevision === undefined) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const name = p.name ?? pet.name;
    const result = await videos.apply(
      {
        videoId: p.videoId,
        commandId: p.commandId,
        expectedRevision,
        operations: [
          {
            type: 'importAsset',
            path: file,
            name,
            ref: APPLIED_ASSET_REF,
            storage: 'managed',
            provenance: { origin: CODEX_PET_ORIGIN, source: { codexPet: pet.source } },
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
    if (!assetId) throw new RpcError('internal', RcStickers.petNotFound({ id: name }));
    return { ...result, assetId };
  }
}

/** RIFF 容器里的 WebP：`RIFF....WEBP`。 */
function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
}
