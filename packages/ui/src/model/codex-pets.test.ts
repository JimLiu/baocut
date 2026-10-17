import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_PETS, setLocale } from '@baocut/protocol';
import { matchCommunityPets, petCredit, petDisplayName, petLayer, petRefKey } from './codex-pets.ts';

// 测试默认跑在 zh-Hans（vitest.config.ts 的 BAOCUT_LOCALE）。
const use = (locale: 'en' | 'zh-Hans') => {
  vi.stubEnv('BAOCUT_LOCALE', locale);
  setLocale(locale);
};
afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('Codex Pets in the elements panel', () => {
  it('searches community pets by category, name, author and slug', () => {
    expect(matchCommunityPets('all', '')).toHaveLength(COMMUNITY_PETS.length);
    const pet = COMMUNITY_PETS.find((p) => p.zh && p.zh !== p.name)!;
    const inCategory = matchCommunityPets(pet.category, '');
    expect(inCategory.every((p) => p.category === pet.category)).toBe(true);
    expect(matchCommunityPets(pet.category, pet.zh).map((p) => p.slug)).toContain(pet.slug);
    expect(matchCommunityPets('all', pet.author).map((p) => p.slug)).toContain(pet.slug);
    expect(matchCommunityPets('all', 'no-such-pet-anywhere')).toEqual([]);
  });

  it('names community pets in Chinese only in a Chinese UI and credits author and license', () => {
    const pet = COMMUNITY_PETS.find((p) => p.zh && p.zh !== p.name && p.license)!;
    use('en');
    expect(petDisplayName(pet)).toBe(pet.name);
    use('zh-Hans');
    expect(petDisplayName(pet)).toBe(pet.zh);
    expect(petCredit(pet)).toBe(`${pet.author} · ${pet.license}`);
    expect(petCredit({ ...pet, license: '' })).toBe(pet.author);
  });

  it('keys a pet by source and slug', () => {
    expect(petRefKey({ source: 'community', slug: 'a--b' })).toBe('community:a--b');
  });

  it('adds a looping sticker layer drawing the copied APNG', () => {
    const layer = petLayer('Codex', { assetImportRef: 'applied' });
    expect(layer).toMatchObject({ type: 'sticker', name: 'Codex', assetImportRef: 'applied', sticker: { source: 'asset', loop: 'loop' } });
  });
});
