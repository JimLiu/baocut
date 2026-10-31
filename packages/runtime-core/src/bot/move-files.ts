import path from 'node:path';
import fs from 'node:fs/promises';
import type { ArtifactRef, ResourceRef } from '@baocut/protocol';

/** `file` 指向频道文件夹里的哪个相对路径；不在文件夹里（别处的绝对路径、往上跳出去的）返回 null。 */
export function relativeInside(base: string, file: string): string | null {
  const full = path.resolve(base, file);
  const rel = path.relative(base, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
}

/** 任务引用到的、在频道文件夹里的文件（相对路径，去重）。 */
export function taskFilePaths(base: string, files: readonly string[], refs: readonly (ResourceRef | ArtifactRef)[]): string[] {
  const out = new Set<string>();
  for (const file of files) {
    const rel = relativeInside(base, file);
    if (rel) out.add(rel);
  }
  for (const ref of refs) {
    if (ref.kind !== 'file') continue;
    const rel = relativeInside(base, ref.path);
    if (rel) out.add(rel);
  }
  return [...out];
}

const SAME_CONTENT_LIMIT = 32 * 1024 * 1024;

async function sameContent(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
  if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
  if (sa.size > SAME_CONTENT_LIMIT) return false;
  const [ba, bb] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return ba.equals(bb);
}

async function exists(file: string): Promise<boolean> {
  return fs.lstat(file).then(
    () => true,
    () => false,
  );
}

/** 目标文件夹里还没被占的名字：`剪辑.mp4` → `剪辑 (2).mp4` → `剪辑 (3).mp4`… */
async function freeName(toDir: string, rel: string, taken: Set<string>): Promise<string> {
  const dir = path.dirname(rel);
  const ext = path.extname(rel);
  const stem = path.basename(rel, ext);
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${stem} (${n})${ext}`);
    if (!taken.has(candidate) && !(await exists(path.join(toDir, candidate)))) return candidate;
  }
}

export interface CarriedFiles {
  /** 旧相对路径 → 新相对路径（只含真的带过去的）。 */
  renamed: Map<string, string>;
  /** 搬家失败时把文件放回原处、删掉复制出来的。 */
  undo(): Promise<void>;
}

/**
 * 任务换频道时把它的文件带到新频道的文件夹（BOT-TK-09）：别的任务也在用的复制一份（原处保留），只有它用的直接搬走。
 * 新频道里同名的文件内容一样就直接用那份，不一样就换个不冲突的名字。
 */
export async function carryTaskFiles(options: { fromDir: string; toDir: string; paths: readonly string[]; shared: ReadonlySet<string> }): Promise<CarriedFiles> {
  const { fromDir, toDir } = options;
  const renamed = new Map<string, string>();
  const steps: (() => Promise<void>)[] = [];
  const taken = new Set<string>();
  const undo = async () => {
    for (const step of steps.reverse()) await step().catch(() => {});
  };
  try {
    for (const rel of options.paths) {
      const src = path.join(fromDir, rel);
      const stat = await fs.stat(src).catch(() => null);
      if (!stat?.isFile()) continue;
      let target = rel;
      let dest = path.join(toDir, target);
      if (taken.has(target) || (await exists(dest))) {
        if (!taken.has(target) && (await sameContent(src, dest).catch(() => false))) {
          renamed.set(rel, target);
          if (!options.shared.has(rel)) {
            await fs.rm(src);
            steps.push(() => fs.copyFile(dest, src));
          }
          continue;
        }
        target = await freeName(toDir, rel, taken);
        dest = path.join(toDir, target);
      }
      taken.add(target);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (options.shared.has(rel)) {
        await fs.copyFile(src, dest);
        steps.push(() => fs.rm(dest, { force: true }));
      } else {
        await fs.rename(src, dest);
        steps.push(() => fs.rename(dest, src));
      }
      renamed.set(rel, target);
    }
  } catch (error) {
    await undo();
    throw error;
  }
  return { renamed, undo };
}

/** 按搬家结果改写引用：原来写相对路径的还写相对路径，写绝对路径的换成新文件夹下的绝对路径。 */
export function rewriteFileRef<T extends ResourceRef | ArtifactRef>(ref: T, fromDir: string, toDir: string, renamed: ReadonlyMap<string, string>): T {
  if (ref.kind !== 'file') return ref;
  const rel = relativeInside(fromDir, ref.path);
  const next = rel ? renamed.get(rel) : undefined;
  if (!rel || next === undefined) return ref;
  return { ...ref, path: path.isAbsolute(ref.path) ? path.join(toDir, next) : next };
}

/** 频道文件夹的快照：相对路径 → 大小与修改时间。跳过以点开头的目录（线程笔记在 `.threads/`）；文件太多时只看前 `limit` 个。 */
export async function snapshotFiles(base: string, limit = 5000): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    if (out.size >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.size >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) out.set(path.relative(base, full), `${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  await walk(base);
  return out;
}

/** 两次快照之间新出现或改过的文件。 */
export function changedFiles(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([rel, sig]) => before.get(rel) !== sig).map(([rel]) => rel);
}
