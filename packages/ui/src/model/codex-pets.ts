import { COMMUNITY_PETS, getLocale, petLicenseNonCommercial, type CommunityPet, type PetRef } from '@baocut/protocol';
import type { LayerAsset, VisualLayer } from './new-items.ts';
import { placeBox } from './new-items.ts';
import { PET_COPY as PT } from './pet-copy.ts';

/**
 * 元素面板里的 Codex Pets（`@baocut/protocol` 的 `pets.ts`，都是社区 pet）：格子要的名字、署名与检索，与贴进视频后新建的
 * 那一层。贴进视频的是 Runtime 编好的待机 APNG（`pets.applyToVideo`），画布上与别的动图一样循环。
 */

/** 社区 pet 的名字：中文界面有中文名时用中文名，其余用原名。 */
export function petDisplayName(pet: CommunityPet): string {
  return getLocale().startsWith('zh') && pet.zh ? pet.zh : pet.name;
}

/** 社区 pet 的署名：作者 · 许可原文（许可缺省时只写作者）。 */
export function petCredit(pet: CommunityPet): string {
  return [pet.author, pet.license].filter(Boolean).join(' · ');
}

export const petNonCommercial = (pet: CommunityPet): boolean => petLicenseNonCommercial(pet.license);

export const petCategoryLabel = (slug: string): string => PT.categories[slug] ?? slug;

/** 社区 pet：先按分类（`all` 是全部），再按名字（原名与中文名）、作者与 slug 检索。 */
export function matchCommunityPets(category: string, query: string): CommunityPet[] {
  const q = query.trim().toLowerCase();
  return COMMUNITY_PETS.filter(
    (pet) =>
      (category === 'all' || pet.category === category) &&
      (!q || [pet.name, pet.zh, pet.author, pet.slug].some((field) => field.toLowerCase().includes(q))),
  );
}

export const petRefKey = (ref: PetRef): string => `${ref.source}:${ref.slug}`;

/** pet 拷进视频后新建的那一层：居中、宽 18%（与随包的动态贴纸一样），循环播放。 */
export function petLayer(name: string, asset: LayerAsset): VisualLayer {
  return {
    type: 'sticker',
    name,
    place: placeBox({ x: 50, y: 50, w: 18 }),
    ...asset,
    sticker: { source: 'asset', loop: 'loop' },
  };
}
