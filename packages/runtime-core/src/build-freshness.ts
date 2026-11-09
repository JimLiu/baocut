import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROTOCOL_VERSION, type ComponentBuild, type ComponentBuildKind } from '@baocut/protocol';

/**
 * 源码 Runtime 用的构建产物与源码是否一致（CLI 独立使用与发布 §7.4）。构建脚本在产物旁写构建戳 `baocut-build.json`
 * （`tools/build-stamp.mjs`：构建 commit、协议版本、构建时间与读过的每个源文件的内容摘要），这里逐个比对此刻仓库里的文件。
 * 比内容而不比 commit：无关的提交、另一个 worktree 借用同一份产物都不算过期。打包的 Runtime 不比（产物与代码同一次构建）。
 */

export const BUILD_STAMP_FILE = 'baocut-build.json';

/** 一份要比对的产物：构建戳在 `dir`，`outputs` 是 Runtime 实际用的文件（比构建戳新说明不是用构建命令编的）。 */
export interface BuildTarget {
  component: ComponentBuildKind;
  dir: string;
  outputs: string[];
  rebuild: string;
}

interface Stamp {
  build: string | null;
  protocolVersion: string | null;
  builtAt: string;
  inputs: Record<string, string>;
}

/** 构建戳写完之后产物还能晚多久（文件系统的时间精度与写入顺序）。 */
const OUTPUT_SLACK_MS = 2_000;
const CHANGED_SHOWN = 5;
const HASH_CONCURRENCY = 32;

/** 文件摘要的缓存：同一个文件修改时间与大小都没变时不重读。 */
const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

async function currentHash(file: string): Promise<string | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const cached = hashCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.hash;
  try {
    const hash = createHash('sha256').update(await fs.promises.readFile(file)).digest('hex').slice(0, 16);
    hashCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
    return hash;
  } catch {
    return null;
  }
}

function readStamp(dir: string): Stamp | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dir, BUILD_STAMP_FILE), 'utf8')) as Partial<Stamp> & { schema?: unknown };
    if (value.schema !== 1 || typeof value.builtAt !== 'string' || typeof value.inputs !== 'object' || value.inputs === null) return null;
    return {
      build: typeof value.build === 'string' ? value.build : null,
      protocolVersion: typeof value.protocolVersion === 'string' ? value.protocolVersion : null,
      builtAt: value.builtAt,
      inputs: value.inputs,
    };
  } catch {
    return null;
  }
}

/** 构建戳里的输入此刻还一样吗：返回变了（或不在了）的那些，按构建戳里的顺序。 */
async function changedInputs(root: string, inputs: Record<string, string>): Promise<string[]> {
  const entries = Object.entries(inputs);
  const changed: boolean[] = new Array(entries.length).fill(false);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < entries.length; index = next++) {
      const [relative, hash] = entries[index]!;
      changed[index] = (await currentHash(path.join(root, ...relative.split('/')))) !== hash;
    }
  };
  await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, entries.length) }, worker));
  return entries.filter((_, index) => changed[index]).map(([relative]) => relative);
}

function mtimeOf(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** 比对一份产物。`root` 是 Runtime 所在的仓库根，构建戳里的相对路径按它解析。 */
export async function checkBuild(root: string, target: BuildTarget, protocolVersion: string = PROTOCOL_VERSION): Promise<ComponentBuild> {
  const base = { component: target.component, path: target.dir, rebuild: target.rebuild };
  const stamp = readStamp(target.dir);
  if (!stamp) return { ...base, state: 'unverified', reason: 'no-stamp', build: null, protocolVersion: null, builtAt: null };
  const stamped = { build: stamp.build, protocolVersion: stamp.protocolVersion, builtAt: stamp.builtAt };
  const builtAt = Date.parse(stamp.builtAt);
  const newer = target.outputs.some((file) => {
    const mtime = mtimeOf(file);
    return mtime !== null && Number.isFinite(builtAt) && mtime > builtAt + OUTPUT_SLACK_MS;
  });
  if (newer) return { ...base, ...stamped, state: 'unverified', reason: 'output-newer' };
  // Web 客户端经协议与 Runtime 说话：协议版本不同一定画不对。Worker 有自己的协议，看源码就够了。
  if (target.component === 'web' && stamp.protocolVersion !== protocolVersion) {
    return { ...base, ...stamped, state: 'stale', reason: 'protocol' };
  }
  const changed = await changedInputs(root, stamp.inputs);
  if (changed.length > 0) {
    return { ...base, ...stamped, state: 'stale', reason: 'inputs', changed: changed.slice(0, CHANGED_SHOWN), changedCount: changed.length };
  }
  return { ...base, ...stamped, state: 'fresh' };
}

/** 源码 Runtime 用到的产物：各 Worker（按所在目录归组，每个目录一份构建戳）、`editor.wasm`、预览的 `preview.wasm` 与 Web 客户端。 */
export function buildTargets(
  root: string,
  found: { workers: readonly (string | null)[]; editorWasm: string | null; web: string | null },
): BuildTarget[] {
  const targets: BuildTarget[] = [];
  const byDir = new Map<string, string[]>();
  for (const file of found.workers) {
    if (!file) continue;
    const dir = path.dirname(file);
    byDir.set(dir, [...(byDir.get(dir) ?? []), file]);
  }
  for (const [dir, outputs] of byDir) {
    const release = path.basename(dir) === 'release';
    targets.push({ component: 'workers', dir, outputs, rebuild: release ? 'npm run build:engine -- --release' : 'npm run build:engine' });
  }
  // 两份 WASM 都内联进 Web 客户端：重编之后 Web 也要重建。
  const wasm = 'npm run build:wasm && npm run build:web';
  if (found.editorWasm) targets.push({ component: 'editor-wasm', dir: path.dirname(found.editorWasm), outputs: [found.editorWasm], rebuild: wasm });
  const preview = path.join(root, 'packages', 'ui', 'src', 'render', 'generated', 'preview.wasm');
  if (fs.existsSync(preview)) targets.push({ component: 'preview-wasm', dir: path.dirname(preview), outputs: [preview], rebuild: wasm });
  if (found.web) targets.push({ component: 'web', dir: found.web, outputs: [path.join(found.web, 'index.html')], rebuild: 'npm run build:web' });
  return targets;
}

export async function checkBuilds(root: string, targets: readonly BuildTarget[]): Promise<ComponentBuild[]> {
  return Promise.all(targets.map((target) => checkBuild(root, target)));
}
