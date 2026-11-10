import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLIED_ASSET_REF, BUILTIN_HOSTS, packSticker, setLocale, stickerHost, type Locale } from '@baocut/protocol';
import { hostName, hostPlace, hostStickers, matchHosts, packStickerLayer, packStickerName } from './sticker-packs.ts';

// 测试默认跑在 zh-Hans（vitest.config.ts 的 BAOCUT_LOCALE）。
const use = (locale: Locale) => {
  vi.stubEnv('BAOCUT_LOCALE', locale);
  setLocale(locale);
};
afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('内置主播在元素面板里', () => {
  it('每个角色一格，次序同目录；格子的名字跟界面语言', () => {
    expect(hostStickers().map((sticker) => stickerHost(sticker)?.id)).toEqual(BUILTIN_HOSTS.map((host) => host.id));
    const rin = BUILTIN_HOSTS[0]!;
    expect(hostName(rin)).toBe('凛');
    use('zh-Hant');
    expect(hostName(rin)).toBe('凜');
    expect(hostName(BUILTIN_HOSTS.find((host) => host.id === 'mio')!)).toBe('澪');
    use('en');
    expect(hostName(rin)).toBe('Rin');
    use('ja');
    expect(hostName(rin)).toBe('Rin');
  });

  it('按画风与名字筛；搜这一节的名字或泛称时整节留着', () => {
    expect(matchHosts('all', '')).toHaveLength(BUILTIN_HOSTS.length);
    const chibi = matchHosts('chibi', '').map((sticker) => stickerHost(sticker)!.id);
    expect(chibi).toEqual(['momo', 'pip', 'nana', 'kuro']);
    expect(matchHosts('all', '凛').map((sticker) => sticker.id)).toEqual(['host-rin.bcpuppet']);
    expect(matchHosts('all', 'kenji').map((sticker) => sticker.id)).toEqual(['host-kenji.bcpuppet']);
    expect(matchHosts('anime', 'Q 版')).toEqual([]);
    expect(matchHosts('all', 'Q 版')).toHaveLength(4);
    expect(matchHosts('all', '主播')).toHaveLength(BUILTIN_HOSTS.length);
    expect(matchHosts('chibi', 'vtuber')).toHaveLength(4);
    expect(matchHosts('all', 'no-such-host')).toEqual([]);
  });

  it('新建的那一层：角色名、右下角，不写播放方式', () => {
    const landscape = { width: 1920, height: 1080 };
    const sticker = packSticker('host-kuro.bcpuppet')!;
    expect(packStickerName(sticker)).toBe('小黑');
    expect(packStickerLayer(sticker, { assetImportRef: APPLIED_ASSET_REF }, landscape)).toEqual({
      type: 'sticker',
      name: '小黑',
      place: { x: 84, y: 73.3, w: 30 },
      assetImportRef: APPLIED_ASSET_REF,
      sticker: { source: 'asset' },
    });
    // 别的贴纸照旧：居中 18% 宽。
    expect(packStickerLayer(packSticker('featured-01.svg')!, { assetImportRef: APPLIED_ASSET_REF }, landscape).place).toEqual({ x: 50, y: 50, w: 18 });
  });

  it('主播的位置随画面比例：右边不出画，半身像的下沿压在画外', () => {
    for (const canvas of [
      { width: 1920, height: 1080 },
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 },
    ]) {
      const { x, y, w } = hostPlace(canvas);
      const height = ((w * canvas.width) / canvas.height) * 1.5;
      expect(x + w / 2, `${canvas.width}x${canvas.height}`).toBeLessThan(100);
      expect(y + height / 2, `${canvas.width}x${canvas.height}`).toBeGreaterThan(105);
      expect(y - height / 2, `${canvas.width}x${canvas.height}`).toBeGreaterThan(0);
    }
    expect(hostPlace({ width: 1080, height: 1920 })).toMatchObject({ x: 74, w: 50 });
  });
});
