import type { Id } from './domain.ts';
import type { EditResult } from './methods.ts';
import type { MessageRef } from './message-ref.ts';
import { COMMUNITY_PETS, PET_CATEGORIES } from './pet-catalog.ts';
import type { EditOperation, Revision } from './video.ts';

/**
 * Codex Pets（元素面板动态贴纸里的「Codex Pets」）：Codex 桌面端桌宠的精灵图。一张 WebP 图集，8 列、每格 192×208，
 * v1 九行、v2 十一行，每行一种状态；贴进视频的是待机那一行编成的循环 APNG（`pets.applyToVideo`，命令与协议规范
 * `pets` 一行）。目录是社区的 239 只（awesome-codex-pet 的索引），数据在 `pet-catalog.ts`（由原型
 * `designs/baocut/app/model-pet-catalog.js` 转写）。图集与缩略图不转存，用到时从上游取；各自的许可（多为 CC BY-NC 4.0）
 * 与作者必须随格子显示。Codex 自带的官方 pet 没有公开的再分发许可，不在目录里。
 */

export interface PetCategory {
  slug: string;
  /** 分类名：英文与中文原文，界面按语言挑，非中文界面用英文。 */
  name: string;
  zh: string;
}

export interface CommunityPet {
  /** awesome-codex-pet 里的目录名，`<名字>--<作者>`。 */
  slug: string;
  name: string;
  /** 中文名；没有时是空串。 */
  zh: string;
  author: string;
  /** 作者主页；没有时是空串。 */
  url: string;
  /** `PET_CATEGORIES` 的 slug。 */
  category: string;
  /** 作者自报的许可原文。 */
  license: string;
  /** 图集版本：1 是九行，2 是十一行。 */
  version: 1 | 2;
}

export { COMMUNITY_PETS, PET_CATEGORIES };

/** 一只 pet：按 slug。`source` 记进素材来源（视频格式规范 §4.5），目前只有 `community`。 */
export type PetRef = { source: 'community'; slug: string };

const COMMUNITY_BY_SLUG = new Map(COMMUNITY_PETS.map((pet) => [pet.slug, pet] as const));

export function communityPet(slug: string): CommunityPet | null {
  return COMMUNITY_BY_SLUG.get(slug) ?? null;
}

const COMMUNITY_PREVIEWS = 'https://codexpet.top/assets/previews/';
const COMMUNITY_RAW = 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/';
/** awesome-codex-pet 仓库（社区目录的出处）。 */
export const COMMUNITY_PETS_REPO = 'https://github.com/legeling/awesome-codex-pet';

/** 社区 pet 的静态缩略图（待机第 0 帧，上游站点预渲染）。 */
export function communityPetThumbnailUrl(slug: string): string {
  return `${COMMUNITY_PREVIEWS}${encodeURIComponent(slug)}/thumbnail.webp`;
}

/** 社区 pet 待机那一行的动图（上游站点预渲染的 WebP 动画，格子悬停时放）。 */
export function communityPetPreviewUrl(slug: string): string {
  return `${COMMUNITY_PREVIEWS}${encodeURIComponent(slug)}/webp/idle.webp`;
}

/** 社区 pet 的整张图集。 */
export function communityPetSheetUrl(slug: string): string {
  return `${COMMUNITY_RAW}${encodeURIComponent(slug)}/spritesheet.webp`;
}

/** 社区 pet 在仓库里的目录页。 */
export function communityPetPageUrl(slug: string): string {
  return `${COMMUNITY_PETS_REPO}/tree/main/pets/${encodeURIComponent(slug)}`;
}

/** 许可是不是明确不许商用（CC BY-NC 或手写的 non-commercial）。 */
export function petLicenseNonCommercial(license: string): boolean {
  return /\bnc\b|non-?commercial|非商/i.test(license);
}

/** 拷进视频的 pet 素材的来源（视频格式规范 §4.5）：`origin` 与 `source.codexPet`。 */
export const CODEX_PET_ORIGIN = 'codex-pet';

export interface PetHandleParams {
  pet: PetRef;
  /** 都从上游取进本机缓存：`sheet` 是整张图集，`thumbnail`（静止的第 0 帧）与 `preview`（待机那一行的动图）是上游预渲染的。 */
  file: 'sheet' | 'thumbnail' | 'preview';
}

export interface PetApplyParams {
  videoId: Id;
  pet: PetRef;
  commandId: Id;
  /** 不给时以视频的当前版本提交。 */
  expectedRevision?: Revision;
  /** 素材的名字；不给时用 pet 的名字。 */
  name?: string;
  /** 同 `stickers.applyToVideo`：导入的素材在这些操作里是 `assetImportRef: 'asset'`，一起提交、一步撤销。 */
  operations?: EditOperation[];
  /** 这笔事务给人看的修改名与它的消息引用；不给时是「添加贴纸」。 */
  label?: string;
  labelRef?: MessageRef;
}

export interface PetApplyResult extends EditResult {
  /** 拷进来的素材（`.apng`，待机那一行，无限循环）。 */
  assetId: Id;
}
