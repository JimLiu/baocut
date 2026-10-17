import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * 生成图片的参考图（架构设计 §6.1 的输入图）：粘贴进来的截图、从浏览器拖进来的图片只有字节、没有本机路径，而 Runtime 的
 * `generateImage` 只收路径、Space 条目与素材，所以先写进系统临时目录下的 `baocut-image-refs/`。文件名与扩展名由这里按文件头
 * 起，不收渲染进程给的名字；提交时 Runtime 冻结摘要、执行前再核对一次，任务很快就跑，每次写之前顺手删掉一天前的。
 */

/** 剪贴板里的图很少过 20 MB；留足余量，超过的不收。 */
export const IMAGE_REF_MAX_BYTES = 64 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const EXTENSIONS = ['.png', '.jpg', '.webp'];

/** 按文件头认 PNG、JPEG、WebP（与 Runtime 收输入图的规则相同），返回扩展名；别的返回 null。 */
export function imageRefExtension(data: Uint8Array): string | null {
  const head = Buffer.from(data.buffer, data.byteOffset, Math.min(12, data.byteLength));
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return '.jpg';
  if (head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/** 只收不超过上限的 PNG、JPEG、WebP 字节。 */
export function imageRefData(value: unknown): { data: Uint8Array; extension: string } {
  if (!(value instanceof Uint8Array)) throw new Error('the image is missing');
  if (value.byteLength > IMAGE_REF_MAX_BYTES) throw new Error('the image is too large');
  const extension = imageRefExtension(value);
  if (!extension) throw new Error('the image is not a PNG, JPEG or WebP file');
  return { data: value, extension };
}

export function imageRefDir(tmp = os.tmpdir()): string {
  return path.join(tmp, 'baocut-image-refs');
}

/** 写下一张参考图，返回绝对路径。 */
export async function writeImageRef(raw: unknown, dir = imageRefDir(), now = Date.now()): Promise<string> {
  const { data, extension } = imageRefData(raw);
  await fs.mkdir(dir, { recursive: true });
  await pruneImageRefs(dir, now);
  const file = path.join(dir, `${randomUUID()}${extension}`);
  await fs.writeFile(file, data);
  return file;
}

async function pruneImageRefs(dir: string, now: number): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => EXTENSIONS.includes(path.extname(name)))
      .map(async (name) => {
        const file = path.join(dir, name);
        const stat = await fs.stat(file).catch(() => null);
        if (stat && now - stat.mtimeMs > MAX_AGE_MS) await fs.rm(file, { force: true });
      }),
  );
}
