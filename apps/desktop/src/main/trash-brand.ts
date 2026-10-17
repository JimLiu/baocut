import path from 'node:path';
import { lstat } from 'node:fs/promises';

/**
 * 删除项目品牌（产品设计 §6.9「项目品牌的管理」）：把项目根目录的 `BRAND.md` 与 `brand/` 移到系统废纸篓 / 回收站
 * （Electron `shell.trashItem`，macOS 与 Windows 都有）。只动这两个名字，不跟随符号链接（链接本身进废纸篓）；
 * 项目目录必须是绝对路径的目录。返回移走的路径；没有 `BRAND.md` 时什么都不动。
 */
export async function trashProjectBrand(value: unknown, trash: (target: string) => Promise<void>): Promise<string[]> {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value) || !path.isAbsolute(value)) throw new Error('invalid project path');
  const root = path.normalize(value);
  if (!(await lstat(root)).isDirectory()) throw new Error('not a project folder');
  const targets: string[] = [];
  for (const name of ['BRAND.md', 'brand']) {
    const target = path.join(root, name);
    try {
      await lstat(target);
      targets.push(target);
    } catch {
      // 没有就不动。
    }
  }
  if (!targets.some((t) => path.basename(t) === 'BRAND.md')) return [];
  for (const target of targets) await trash(target);
  return targets;
}
