import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Hex } from './input-hash.ts';

/**
 * 最小的内容寻址产物库（架构设计 §5.1、§7.3）：`<artifacts>/<sha256hex>.<ext>`，`artifactId = 'sha256:<hex>'`。
 * 转写结果是 `.json`；生成的媒体按格式（`.mp3`、`.wav`、`.flac`、`.png`、`.jpg`、`.webp`）；导出的文件按格式
 * （字幕与文稿 `.srt`、`.vtt`、`.ass`、`.md`、`.txt`、`.json`，音频 `.wav`、`.mp3`、`.m4a`，成片 `.mp4`、`.webm`）。
 * 写入是临时文件加 rename；同一内容只存一份，发布后不可变。
 */

/** 产物文件可用的扩展名。 */
export const ARTIFACT_EXTENSIONS = [
  'json',
  'txt',
  'mp3',
  'wav',
  'flac',
  'png',
  'jpg',
  'webp',
  'm4a',
  'srt',
  'vtt',
  'ass',
  'md',
  'mp4',
  'webm',
] as const;
export type ArtifactExtension = (typeof ARTIFACT_EXTENSIONS)[number];

/** 一段内容的产物 ID（`sha256:<hex>`）：写进产物库之前就算得出，发布意图据此先落账（§7.3）。 */
export function artifactIdOf(bytes: Uint8Array): string {
  return `sha256:${sha256Hex(bytes)}`;
}

export class ArtifactStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async put(bytes: Uint8Array, extension: ArtifactExtension = 'json'): Promise<{ artifactId: string; path: string }> {
    const hex = sha256Hex(bytes);
    const file = path.join(this.dir, `${hex}.${extension}`);
    const exists = await fs.stat(file).then(
      (s) => s.isFile() && s.size === bytes.length,
      () => false,
    );
    if (!exists) {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, bytes, { mode: 0o644 });
      await fs.rename(tmp, file);
    }
    return { artifactId: `sha256:${hex}`, path: file };
  }

  /** 把一个文件存为产物（边读边算摘要，不整个读进内存；导出的音频与成片用它）。文件系统支持时克隆而不复制（APFS）。 */
  async putFile(source: string, extension: ArtifactExtension): Promise<{ artifactId: string; path: string; byteLength: number }> {
    const hash = createHash('sha256');
    let byteLength = 0;
    for await (const chunk of createReadStream(source)) {
      hash.update(chunk as Buffer);
      byteLength += (chunk as Buffer).length;
    }
    const hex = hash.digest('hex');
    const file = path.join(this.dir, `${hex}.${extension}`);
    const exists = await fs.stat(file).then(
      (s) => s.isFile() && s.size === byteLength,
      () => false,
    );
    if (!exists) {
      await fs.mkdir(this.dir, { recursive: true });
      const tmp = `${file}.${randomUUID()}.tmp`;
      await fs.copyFile(source, tmp, constants.COPYFILE_FICLONE);
      await fs.chmod(tmp, 0o644);
      await fs.rename(tmp, file);
    }
    return { artifactId: `sha256:${hex}`, path: file, byteLength };
  }

  /** JSON 产物（转写结果）的路径。 */
  pathOf(artifactId: string): string | null {
    const match = /^sha256:([0-9a-f]{64})$/.exec(artifactId);
    return match ? path.join(this.dir, `${match[1]}.json`) : null;
  }

  /** 任何扩展名的产物的路径；不存在时 null。 */
  async locate(artifactId: string): Promise<string | null> {
    const match = /^sha256:([0-9a-f]{64})$/.exec(artifactId);
    if (!match) return null;
    for (const extension of ARTIFACT_EXTENSIONS) {
      const file = path.join(this.dir, `${match[1]}.${extension}`);
      if (
        await fs.stat(file).then(
          (s) => s.isFile(),
          () => false,
        )
      )
        return file;
    }
    return null;
  }

  /** 产物在、内容与摘要相符（写入没有 fsync，崩溃之后可能残缺）。 */
  async verify(artifactId: string): Promise<boolean> {
    const file = await this.locate(artifactId);
    if (!file) return false;
    const hash = createHash('sha256');
    try {
      for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    } catch {
      return false;
    }
    return `sha256:${hash.digest('hex')}` === artifactId;
  }

  async read(artifactId: string): Promise<Buffer | null> {
    const file = await this.locate(artifactId);
    return file ? fs.readFile(file).catch(() => null) : null;
  }
}

/**
 * 一个任务输出的文件（智能体与对外服务按 `artifactId` 用它：`importAsset`、`artifacts_save`）。产物库里有就用库里的；
 * 没有时看输出登记的 `path`（从链接导入、文件转码这类发布到用户目录的输出不进产物库，`artifactId` 是那个文件的内容摘要）：
 * 文件还在、大小与登记的一致、内容摘要与 `artifactId` 相同才用它，否则 null（挪走、删掉或改过都算不在了）。
 */
export async function locateArtifact(
  store: ArtifactStore,
  artifactId: string,
  output: { path?: string | null; byteLength?: number } | null,
): Promise<string | null> {
  const stored = await store.locate(artifactId);
  if (stored) return stored;
  const match = /^sha256:([0-9a-f]{64})$/.exec(artifactId);
  const file = output?.path;
  if (!match || typeof file !== 'string' || !path.isAbsolute(file)) return null;
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile() || (output?.byteLength !== undefined && stat.size !== output.byteLength)) return null;
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  } catch {
    return null;
  }
  return hash.digest('hex') === match[1] ? file : null;
}
