import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localDocumentPath, openLocalFile } from './open-local-file.ts';

describe('系统默认应用打开产物', () => {
  let dir: string | undefined;
  afterEach(async () => { if (dir) await fs.rm(dir, { recursive: true, force: true }); });
  it('只接受绝对文档或媒体路径，不执行脚本、程序、快捷方式或 URL', () => {
    for (const input of [null, {}, 'clip.mp4', 'https://example.com/clip.mp4', 'file:///tmp/clip.mp4',
      '/tmp/run.sh', '/tmp/app.exe', '/tmp/link.lnk', '/tmp/app.command', '/tmp/bad\0.mp4']) {
      expect(localDocumentPath(input)).toBeNull();
    }
    expect(localDocumentPath(path.join(os.tmpdir(), '成片.MP4'))).toBe(path.join(os.tmpdir(), '成片.MP4'));
  });
  it('存在的文件交给系统，目录与不存在的文件不交给系统；系统错误原样返回', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-open-file-'));
    const file = path.join(dir, '成片.mp4');
    await fs.writeFile(file, 'fixture');
    const open = vi.fn(async () => '');
    expect(await openLocalFile(file, open)).toBe('');
    expect(open).toHaveBeenCalledExactlyOnceWith(file);
    open.mockClear();
    expect(await openLocalFile(path.join(dir, 'missing.pdf'), open)).toContain('ENOENT');
    expect(await openLocalFile(path.join(dir, 'missing.abc'), open)).toContain('ENOENT');
    const unknown = path.join(dir, 'unknown.abc'); await fs.writeFile(unknown, 'hello');
    expect(await openLocalFile(unknown, open)).toBeNull();
    const folder = path.join(dir, 'folder.pdf');
    await fs.mkdir(folder);
    expect(await openLocalFile(folder, open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(await openLocalFile(file, async () => 'No application')).toBe('No application');
  });
});
