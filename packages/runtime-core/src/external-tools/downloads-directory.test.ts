import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDownloadsDirectory, resolveSaveDirectory } from './downloads-directory.ts';

/** 下载目录与保存位置（架构设计 §7.9）：调用给的目录、设置、主机的下载文件夹，依次兜底。 */

describe('保存位置', () => {
  const host = process.env.BAOCUT_DOWNLOADS_DIR;
  afterEach(() => {
    if (host === undefined) delete process.env.BAOCUT_DOWNLOADS_DIR;
    else process.env.BAOCUT_DOWNLOADS_DIR = host;
  });

  it('调用给了目录用它；否则设置；再否则主机的下载文件夹', () => {
    process.env.BAOCUT_DOWNLOADS_DIR = '/host/Downloads';
    expect(resolveSaveDirectory({ override: '/picked', settings: '/configured' })).toBe('/picked');
    expect(resolveSaveDirectory({ override: null, settings: '/configured' })).toBe('/configured');
    expect(resolveSaveDirectory({ settings: null })).toBe('/host/Downloads');
    expect(resolveSaveDirectory({ override: '', settings: null })).toBe(resolveDownloadsDirectory(null));
  });

  it('主机没有传下载文件夹时用主目录下的 Downloads', () => {
    delete process.env.BAOCUT_DOWNLOADS_DIR;
    expect(resolveSaveDirectory({ settings: null })).toBe(path.join(os.homedir(), 'Downloads'));
  });
});
