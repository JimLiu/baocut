import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIMATED_STICKER_PACKS, PACK_STICKER_COUNT, STICKER_PACKS, packStickers, type EditOperation } from '@baocut/protocol';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { OnlineAsset, OnlineAssets } from '../online-assets.ts';
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
    const packs = new StickerPacks({ dir, online: null, videos: {} as VideoService });
    await packs.openHandle({ id: 'dyn-emoji-01.json' }, media);
    expect(issued).toEqual([path.join(dir, 'anim/dyn-emoji-01.json')]);
    await expect(packs.locate('featured-99.svg')).rejects.toMatchObject({ code: 'not-found' });
    await expect(new StickerPacks({ dir: null, online: null, videos: {} as VideoService }).locate('featured-01.svg')).rejects.toMatchObject(
      {
        code: 'not-found',
      },
    );
  });

  it('打包的应用只带动态贴纸的清单：按清单的大小与 sha256 从素材 CDN 取进缓存', async () => {
    const bundled = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-stickers-'));
    try {
      fs.copyFileSync(path.join(dir, 'cta-like.svg'), path.join(bundled, 'cta-like.svg'));
      fs.mkdirSync(path.join(bundled, 'anim'));
      fs.copyFileSync(path.join(dir, 'anim/provenance.json'), path.join(bundled, 'anim/provenance.json'));
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'anim/provenance.json'), 'utf8'));
      const wanted: OnlineAsset[] = [];
      const online = {
        cacheDir: '/cache',
        ensure: async (asset: OnlineAsset) => (wanted.push(asset), path.join('/cache', asset.path)),
      } as unknown as OnlineAssets;
      const packs = new StickerPacks({ dir: bundled, online, videos: {} as VideoService });
      expect(await packs.locate('dyn-emoji-01.json')).toMatchObject({ root: '/cache', file: 'stickers/anim/dyn-emoji-01.json' });
      expect(wanted).toEqual([
        {
          path: 'stickers/anim/dyn-emoji-01.json',
          bytes: manifest['dyn-emoji-01.json'].bytes,
          sha256: manifest['dyn-emoji-01.json'].sha256,
        },
      ]);
      // 静态贴纸照旧在包里；没有 CDN 时动态贴纸是「没带」。
      expect(await packs.locate('cta-like.svg')).toMatchObject({ root: bundled, file: 'cta-like.svg' });
      await expect(
        new StickerPacks({ dir: bundled, online: null, videos: {} as VideoService }).locate('dyn-emoji-01.json'),
      ).rejects.toMatchObject({
        code: 'not-found',
      });
    } finally {
      fs.rmSync(bundled, { recursive: true, force: true });
    }
  });

  it('动态贴纸的清单与文件一致', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'anim/provenance.json'), 'utf8'));
    for (const file of filesIn(dir, 'anim')) {
      const bytes = fs.readFileSync(path.join(dir, file));
      const entry = manifest[path.basename(file)];
      expect(entry, file).toMatchObject({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
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
    const packs = new StickerPacks({ dir, online: null, videos });
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
    expect(applied[0]).toMatchObject({ label: expect.stringContaining('cta-like.svg') });
  });

  it('调用方的后续修改接在导入后面、同一笔事务（一步撤销），修改名用调用方的', async () => {
    const applied: { operations: EditOperation[]; expectedRevision: string; label?: string; labelRef?: unknown }[] = [];
    const videos = {
      mirror: () => ({ video: { revision: '7' } }),
      apply: async (p: (typeof applied)[number]) => {
        applied.push(p);
        return { receipt: { refs: { asset: 'a_1' } }, replayed: false };
      },
    } as unknown as VideoService;
    const insert = {
      type: 'insertItems',
      sequenceId: 's1',
      items: [{ type: 'sticker', assetImportRef: 'asset' }],
    } as unknown as EditOperation;
    await new StickerPacks({ dir, online: null, videos }).applyToVideo(
      {
        videoId: 'v1',
        id: 'cta-like.svg',
        commandId: 'c1',
        expectedRevision: '6',
        operations: [insert],
        label: '添加 · 赞',
        labelRef: { key: 'editLabel.addNamed', params: { name: '赞' } },
      },
      {} as TrustedPrincipal,
    );
    expect(applied[0]!.expectedRevision).toBe('6');
    expect(applied[0]!.operations.map((op) => op.type)).toEqual(['importAsset', 'insertItems']);
    expect(applied[0]).toMatchObject({ label: '添加 · 赞', labelRef: { key: 'editLabel.addNamed', params: { name: '赞' } } });
  });
});
