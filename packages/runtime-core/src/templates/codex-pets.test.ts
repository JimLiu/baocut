import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMUNITY_PETS, PET_CATEGORIES, communityPetPreviewUrl, communityPetSheetUrl, communityPetThumbnailUrl } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { OnlineAssets } from '../online-assets.ts';
import type { VideoService } from '../videos/video-service.ts';
import { CodexPets } from './codex-pets.ts';

const webp = (body = 'sheet') => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.from(body)]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('Codex Pets', () => {
  let cache: string;
  let fetched: string[];
  let served: Record<string, Buffer>;
  let converted: [string, string][];
  let applied: unknown[];
  let issued: string[];

  beforeEach(() => {
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-pets-'));
    fetched = [];
    served = {};
    converted = [];
    applied = [];
    issued = [];
  });
  afterEach(() => fs.rmSync(cache, { recursive: true, force: true }));

  const pets = () => {
    const online = { cacheDir: cache } as unknown as OnlineAssets;
    const videos = {
      petIdleApng: async (sheet: string, out: string) => {
        converted.push([sheet, out]);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, 'apng');
        return { version: 2, durationMs: 1100 };
      },
      mirror: () => ({ video: { revision: '7' } }),
      apply: async (request: unknown) => (applied.push(request), { receipt: { refs: { asset: 'ast_1' } } }),
    } as unknown as VideoService;
    const fetchStub = (async (url: string) => {
      fetched.push(url);
      const body = served[url];
      return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
    }) as typeof fetch;
    return new CodexPets({ online, videos, fetch: fetchStub });
  };
  const media = {
    issue: async (root: string, file: string) => (issued.push(path.join(root, file)), { url: file }),
  } as unknown as MediaRegistry;

  it('目录：社区 239 只，分类都在目录里', () => {
    expect(COMMUNITY_PETS).toHaveLength(239);
    const categories = new Set(PET_CATEGORIES.map((category) => category.slug));
    expect(COMMUNITY_PETS.every((pet) => categories.has(pet.category))).toBe(true);
    expect(new Set(COMMUNITY_PETS.map((pet) => pet.slug)).size).toBe(239);
    expect(COMMUNITY_PETS.every((pet) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pet.slug))).toBe(true);
  });

  it('社区 pet 从上游取进缓存，之后离线也用缓存；不是 WebP、取不下来时报 ONLINE_ASSET_UNAVAILABLE', async () => {
    const slug = COMMUNITY_PETS[0]!.slug;
    served[communityPetThumbnailUrl(slug)] = webp('thumb');
    const service = pets();
    await Promise.all([
      service.openHandle({ pet: { source: 'community', slug }, file: 'thumbnail' }, media),
      service.openHandle({ pet: { source: 'community', slug }, file: 'thumbnail' }, media),
    ]);
    expect(fetched).toEqual([communityPetThumbnailUrl(slug)]);
    served = {};
    await pets().openHandle({ pet: { source: 'community', slug }, file: 'thumbnail' }, media);
    expect(fetched).toHaveLength(1);
    expect(issued.at(-1)).toBe(path.join(cache, 'pets/community', slug, 'thumbnail.webp'));
    served[communityPetPreviewUrl(slug)] = webp('preview');
    await pets().openHandle({ pet: { source: 'community', slug }, file: 'preview' }, media);
    expect(issued.at(-1)).toBe(path.join(cache, 'pets/community', slug, 'idle.webp'));

    await expect(pets().openHandle({ pet: { source: 'community', slug }, file: 'sheet' }, media)).rejects.toMatchObject({
      details: { code: 'ONLINE_ASSET_UNAVAILABLE', path: `pets/community/${slug}/spritesheet.webp` },
    });
    served[communityPetSheetUrl(slug)] = Buffer.from('<html>not found</html>');
    await expect(pets().openHandle({ pet: { source: 'community', slug }, file: 'sheet' }, media)).rejects.toMatchObject({
      details: { code: 'ONLINE_ASSET_UNAVAILABLE' },
    });
    expect(fs.existsSync(path.join(cache, 'pets/community', slug, 'spritesheet.webp'))).toBe(false);
    await expect(pets().openHandle({ pet: { source: 'community', slug: 'not-in-catalog' }, file: 'sheet' }, media)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('贴进视频：待机那一行编成 APNG（同一张图集只编一次），导入与调用方的修改同一笔事务', async () => {
    const pet = COMMUNITY_PETS[0]!;
    const sheet = webp('community sheet');
    served[communityPetSheetUrl(pet.slug)] = sheet;
    const service = pets();
    const operations = [{ type: 'insertItem', item: { assetImportRef: 'asset' } }] as never;
    const result = await service.applyToVideo(
      { videoId: 'vid_1', pet: { source: 'community', slug: pet.slug }, commandId: 'cmd_1', operations, label: 'Add' },
      {} as TrustedPrincipal,
    );
    expect(result.assetId).toBe('ast_1');
    const idle = path.join(cache, 'pets/idle', `${sha(sheet)}.apng`);
    expect(converted).toEqual([[path.join(cache, 'pets/community', pet.slug, 'spritesheet.webp'), idle]]);
    expect(applied).toEqual([
      {
        videoId: 'vid_1',
        commandId: 'cmd_1',
        expectedRevision: '7',
        operations: [
          {
            type: 'importAsset',
            path: idle,
            name: pet.name,
            ref: 'asset',
            storage: 'managed',
            provenance: {
              origin: 'codex-pet',
              source: {
                codexPet: {
                  source: 'community',
                  slug: pet.slug,
                  name: pet.name,
                  author: pet.author,
                  license: pet.license,
                  version: pet.version,
                },
              },
            },
          },
          { type: 'insertItem', item: { assetImportRef: 'asset' } },
        ],
        label: 'Add',
      },
    ]);
    await service.applyToVideo(
      { videoId: 'vid_1', pet: { source: 'community', slug: pet.slug }, commandId: 'cmd_2' },
      {} as TrustedPrincipal,
    );
    expect(converted).toHaveLength(1);
  });
});
