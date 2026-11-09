import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_HOSTS, RpcError } from '@baocut/protocol';
import type { VideoService } from '../videos/video-service.ts';
import { StickerPacks, resolveStickerPacksDir } from '../templates/sticker-packs.ts';
import { HostTools } from './host-tools.ts';
import { ToolError } from './tool-catalog.ts';
import type { ToolPrincipal, ToolScope } from './tool-scope.ts';

const dir = resolveStickerPacksDir({})!;
const principal = {} as ToolPrincipal;
const scope = { authorize: () => undefined } as unknown as ToolScope;

describe('内置主播的工具', () => {
  const tools = new HostTools({ stickers: new StickerPacks({ dir, online: null, videos: {} as VideoService }), scope });

  it('hosts_list：每个角色带外貌、画风与缩略图路径；style 只列一种画风', async () => {
    const all = (await tools.dispatch('hosts_list', {}, principal)) as { hosts: { id: string; thumbnail: string | null }[] };
    expect(all.hosts.map((host) => host.id)).toEqual(BUILTIN_HOSTS.map((host) => host.id));
    expect(all.hosts[0]).toMatchObject({ id: 'rin', name: 'Rin', zh: '凛', style: 'anime', gender: 'female', age: 'twenties', look: expect.stringContaining('brown hair') });
    expect(all.hosts.every((host) => host.thumbnail === path.join(dir, 'hosts', `host-${host.id}.webp`))).toBe(true);
    const chibi = (await tools.dispatch('hosts_list', { style: 'chibi' }, principal)) as { hosts: { style: string }[] };
    expect(chibi.hosts.length).toBeGreaterThan(0);
    expect(chibi.hosts.every((host) => host.style === 'chibi')).toBe(true);
  });

  it('hosts_show：角色包的绝对路径与一条现成的 importAsset', async () => {
    const shown = (await tools.dispatch('hosts_show', { id: 'kuro' }, principal)) as Record<string, unknown>;
    const file = path.join(dir, 'hosts', 'host-kuro.bcpuppet');
    expect(shown).toMatchObject({
      id: 'kuro',
      style: 'chibi',
      gender: 'female',
      age: 'child',
      path: file,
      importAsset: { type: 'importAsset', path: file, name: 'Kuro', ref: 'host', storage: 'managed' },
    });
  });

  it('没有的角色报 HOST_NOT_FOUND；取不到角色包报 HOST_UNAVAILABLE', async () => {
    await expect(tools.dispatch('hosts_show', { id: 'nobody' }, principal)).rejects.toMatchObject({ code: 'HOST_NOT_FOUND' });
    const offline = new HostTools({
      stickers: {
        locate: async () => {
          throw new RpcError('internal', 'network down', { code: 'ONLINE_ASSET_UNAVAILABLE' });
        },
        bundledFile: () => null,
      },
      scope,
    });
    const error = await offline.dispatch('hosts_show', { id: 'rin' }, principal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toMatchObject({ code: 'HOST_UNAVAILABLE' });
  });
});
