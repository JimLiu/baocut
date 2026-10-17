import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { trashProjectBrand } from './trash-brand.ts';

describe('把项目品牌移到废纸篓', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('只移 BRAND.md 与 brand/，别的文件不动；没有 BRAND.md 时什么都不移', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-trash-brand-'));
    await fs.writeFile(path.join(dir, 'BRAND.md'), '# B');
    await fs.mkdir(path.join(dir, 'brand'));
    await fs.writeFile(path.join(dir, 'README.md'), 'r');
    const trash = vi.fn(async (_target: string) => {});
    expect(await trashProjectBrand(dir, trash)).toEqual([path.join(dir, 'BRAND.md'), path.join(dir, 'brand')]);
    expect(trash.mock.calls.map(([t]) => t)).toEqual([path.join(dir, 'BRAND.md'), path.join(dir, 'brand')]);
    await fs.rm(path.join(dir, 'BRAND.md'));
    trash.mockClear();
    expect(await trashProjectBrand(dir, trash)).toEqual([]);
    expect(trash).not.toHaveBeenCalled();
  });

  it('拒绝相对路径、带控制字符的路径与不是目录的路径', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-trash-brand-'));
    const file = path.join(dir, 'f.txt');
    await fs.writeFile(file, 'x');
    const trash = vi.fn(async (_target: string) => {});
    for (const bad of [null, 'project', `${dir}\0`, file]) await expect(trashProjectBrand(bad, trash)).rejects.toThrow();
    expect(trash).not.toHaveBeenCalled();
  });
});
