import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMATED_STICKER_PACKS, PACK_STICKER_COUNT, STICKER_PACKS, packStickers, type EditOperation } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { VideoService } from '../videos/video-service.ts';
import { StickerPacks, resolveStickerPacksDir } from './sticker-packs.ts';

const dir = resolveStickerPacksDir({})!;
const prototype = path.join(dir, '../designs/baocut/assets/stickers');

const filesIn = (root: string, sub = ''): string[] =>
  fs
    .readdirSync(path.join(root, sub))
    .filter((name) => /\.(svg|json)$/.test(name) && name !== 'provenance.json')
    .map((name) => (sub ? `${sub}/${name}` : name))
    .sort();

describe('随包贴纸', () => {
  it('开发时找到仓库根的 stickers/，环境变量优先', () => {
    expect(path.basename(dir)).toBe('stickers');
    expect(resolveStickerPacksDir({ BAOCUT_STICKERS_DIR: '/opt/x/stickers' })).toBe('/opt/x/stickers');
  });

  it('目录与 stickers/ 里的文件一一对应：301 张 SVG、81 份 Lottie', () => {
    const listed = [...STICKER_PACKS, ...ANIMATED_STICKER_PACKS].flatMap((pack) => packStickers(pack).map((s) => s.path)).sort();
    expect(listed).toEqual([...filesIn(dir), ...filesIn(dir, 'anim')].sort());
    expect(STICKER_PACKS.flatMap((pack) => pack.files)).toHaveLength(301);
    expect(ANIMATED_STICKER_PACKS.flatMap((pack) => pack.files)).toHaveLength(81);
    expect(PACK_STICKER_COUNT).toBe(382);
  });

  it('与原型那一份逐字节相同', () => {
    const files = [...filesIn(dir), ...filesIn(dir, 'anim'), 'provenance.json', 'anim/provenance.json'];
    expect(filesIn(prototype)).toEqual(filesIn(dir));
    for (const file of files) {
      expect(fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(prototype, file))), file).toBe(true);
    }
  });

  it('句柄只发给目录里的贴纸', async () => {
    const issued: string[] = [];
    const media = {
      issue: async (root: string, file: string) => (issued.push(path.join(root, file)), { url: file }),
    } as unknown as MediaRegistry;
    const packs = new StickerPacks({ dir, videos: {} as VideoService });
    await packs.openHandle({ id: 'dyn-emoji-01.json' }, media);
    expect(issued).toEqual([path.join(dir, 'anim/dyn-emoji-01.json')]);
    expect(() => packs.locate('featured-99.svg')).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => new StickerPacks({ dir: null, videos: {} as VideoService }).locate('featured-01.svg')).toThrow(
      expect.objectContaining({ code: 'not-found' }),
    );
  });

  it('拷进视频是一笔 managed 的 importAsset，来源记贴纸 ID', async () => {
    const applied: { operations: EditOperation[]; expectedRevision: string }[] = [];
    const videos = {
      mirror: () => ({ video: { revision: '7' } }),
      apply: async (p: { operations: EditOperation[]; expectedRevision: string }) => {
        applied.push(p);
        return { receipt: { refs: { asset: 'a_1' } }, replayed: false };
      },
    } as unknown as VideoService;
    const packs = new StickerPacks({ dir, videos });
    const result = await packs.applyToVideo({ videoId: 'v1', id: 'cta-like.svg', commandId: 'c1' }, {} as TrustedPrincipal);
    expect(result.assetId).toBe('a_1');
    expect(applied[0]!.expectedRevision).toBe('7');
    expect(applied[0]!.operations).toEqual([
      {
        type: 'importAsset',
        path: path.join(dir, 'cta-like.svg'),
        name: 'cta-like.svg',
        ref: 'asset',
        storage: 'managed',
        provenance: { origin: 'sticker-pack', source: { stickerPack: { id: 'cta-like.svg' } } },
      },
    ]);
  });
});
