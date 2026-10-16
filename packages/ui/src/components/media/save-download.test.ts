// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportSave, saveBlob, saveError, saveMedia } from './save-download.ts';

const mocks = vi.hoisted(() => ({ positive: vi.fn(), negative: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@react-spectrum/s2', () => ({ ToastQueue: { positive: mocks.positive, negative: mocks.negative } }));
vi.mock('./gif.ts', () => ({ downloadBlob: mocks.downloadBlob }));

beforeEach(() => vi.clearAllMocks());

const media = 'http://127.0.0.1:63726/media/AbC/%E7%8C%AB.png';

describe('下载媒体通道里的文件', () => {
  it('桌面端：交给主进程弹存储对话框、写盘，存好后提示路径；不点浏览器链接', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    const saveUrl = vi.fn(async () => '/Users/me/Downloads/猫.png');
    await saveMedia({ saveUrl }, media, '猫.png', '/Users/me/Downloads');
    expect(saveUrl).toHaveBeenCalledExactlyOnceWith({
      url: media,
      defaultName: '猫.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
      defaultDir: '/Users/me/Downloads',
    });
    expect(mocks.positive).toHaveBeenCalledExactlyOnceWith('已保存到 ~/Downloads/猫.png', { timeout: 5000 });
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it('桌面端：没有默认保存位置、没有扩展名时不带这两项；取消不提示', async () => {
    const saveUrl = vi.fn(async () => null);
    await saveMedia({ saveUrl }, media, 'README', null);
    expect(saveUrl).toHaveBeenCalledExactlyOnceWith({ url: media, defaultName: 'README' });
    expect(mocks.positive).not.toHaveBeenCalled();
  });

  it('桌面端：失败时抛出给人看的原因，不带 Electron 的前缀', async () => {
    const saveUrl = vi.fn(async () => {
      throw new Error("Error invoking remote method 'baocut:save-url': Error: HTTP 404");
    });
    await expect(saveMedia({ saveUrl }, media, '猫.png')).rejects.toThrow(/^HTTP 404$/);
    reportSave(saveMedia({ saveUrl }, media, '猫.png'));
    await vi.waitFor(() => expect(mocks.negative).toHaveBeenCalledExactlyOnceWith('没能保存：HTTP 404', { timeout: 6000 }));
  });

  it('Web：同源地址按给的文件名交给浏览器下载，跨源的带 download=1', async () => {
    const clicked: { href: string; download: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    });
    await saveMedia({}, '/media/AbC/a.png', '生成的图.png');
    await saveMedia({}, media, '猫.png');
    expect(clicked).toEqual([
      { href: new URL('/media/AbC/a.png', location.href).href, download: '生成的图.png' },
      { href: `${media}?download=1`, download: '猫.png' },
    ]);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    click.mockRestore();
  });
});

describe('下载界面手上的内容', () => {
  it('桌面端经 saveFile 由主进程写盘，存好后提示', async () => {
    const saveFile = vi.fn(async () => '/tmp/frame-2.png');
    await saveBlob({ saveFile }, new Blob([new Uint8Array([1, 2])]), 'frame-2.png', '/tmp');
    expect(saveFile).toHaveBeenCalledExactlyOnceWith({
      data: new Uint8Array([1, 2]),
      defaultName: 'frame-2.png',
      filters: [{ name: 'PNG', extensions: ['png'] }],
      defaultDir: '/tmp',
    });
    expect(mocks.positive).toHaveBeenCalledOnce();
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('Web 交给浏览器下载', async () => {
    const blob = new Blob(['gif']);
    await saveBlob({}, blob, 'a.gif');
    expect(mocks.downloadBlob).toHaveBeenCalledExactlyOnceWith(blob, 'a.gif');
  });
});

describe('失败的原因', () => {
  it('去掉 Electron 的前缀，其余原样', () => {
    expect(saveError(new Error("Error invoking remote method 'baocut:save-file': Error: EACCES: permission denied"))).toBe('EACCES: permission denied');
    expect(saveError(new Error('disk full'))).toBe('disk full');
    expect(saveError('boom')).toBe('boom');
  });
});
