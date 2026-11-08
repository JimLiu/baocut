#!/usr/bin/env node
/**
 * 放随应用分发的 LiteRT-LM C 库（检索规格 v0.1 §4.3；登记在 `packages/models/src/embedding-bundles.ts` 的
 * `LITERTLM_RUNTIME_RELEASE.bundled`）：上游没有为这些平台发布 C 库，BaoCut 从上游源码构建、把压缩包提交在
 * `packages/models/vendor/litertlm-runtime/`（来源与重建步骤见那里的 README）。这里核对压缩包的大小与 sha256，解开根目录的文件，
 * 再写组件清单 `.bcut-manifest.json`：Runtime 按它判断库在不在、交给 Model Worker 时带上动态库的文件清单。
 *
 * 打包脚本（`package-desktop.mjs`）放进 `<resources>/bin/litertlm-runtime/`；开发时放进 cargo 产物目录的 `litertlm-runtime/`，Runtime
 * 在那里找它（`findBundledToolDir`）。
 *
 *   node tools/fetch-litertlm-runtime.ts                                  放这台机器的库到 cargo 产物目录的 litertlm-runtime/
 *   node tools/fetch-litertlm-runtime.ts --platform win32 --arch x64 --out <目录>
 *
 * 目录里的 `.release.json` 记着解开的是哪个包，与登记一致时什么都不做。这个平台不随应用分发时报错（macOS 的库随模型包下载，不经这里）。
 * 根 `package.json` 的 `build:litertlm-runtime` 跑它，`setup` 包含它（不随应用分发的平台跳过）。
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LITERTLM_RUNTIME_COMPONENT, LITERTLM_RUNTIME_RELEASE } from '../packages/models/src/embedding-bundles.ts';
import { bundledReleaseAsset, hostPlatformKey } from '../packages/models/src/release-component.ts';
import { extractToolArchive } from '../packages/models/src/tool-archive.ts';
import { cargoTargetDirs } from '../packages/process-host/src/cargo-target.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = '.release.json';
/** 组件清单的文件名（与 `packages/models` 的 `MANIFEST_FILE` 相同）。 */
const MANIFEST_FILE = '.bcut-manifest.json';
/** 仓库里放压缩包的目录。 */
export const LITERTLM_VENDOR_DIR = path.join(ROOT, 'packages/models/vendor', LITERTLM_RUNTIME_RELEASE.name);

export interface FetchLiteRtLmOptions {
  platform: string;
  arch: string;
  /** 解开到哪里（整个目录会被替换）。 */
  dest: string;
  /** 压缩包所在的目录；不给时是仓库里的 `packages/models/vendor/litertlm-runtime/`。 */
  archiveDir?: string;
  log?: (line: string) => void;
}

/** 这个平台随应用分发库吗（`ComponentRelease.bundled` 里有它）。 */
export function bundlesLiteRtLm(platform: string, arch: string): boolean {
  return bundledReleaseAsset(LITERTLM_RUNTIME_RELEASE, hostPlatformKey(platform, arch)) !== null;
}

/** 放一个平台的库到 `dest`；返回动态库的路径。这个平台不随应用分发、或压缩包与登记不符时抛错。 */
export async function fetchLiteRtLmRuntime(options: FetchLiteRtLmOptions): Promise<string> {
  const log = options.log ?? ((line: string) => console.log(line));
  const key = hostPlatformKey(options.platform, options.arch);
  const asset = bundledReleaseAsset(LITERTLM_RUNTIME_RELEASE, key);
  if (!asset) throw new Error(`LiteRT-LM ${LITERTLM_RUNTIME_RELEASE.version} is not bundled for ${key}`);
  const library = path.join(options.dest, asset.executable);
  const stamp = { version: LITERTLM_RUNTIME_RELEASE.version, file: asset.fileName, sha256: asset.sha256 };
  const current = await fs.readFile(path.join(options.dest, STAMP), 'utf8').then(JSON.parse, () => null);
  if (current && JSON.stringify(current) === JSON.stringify(stamp) && (await isFile(path.join(options.dest, MANIFEST_FILE))) && (await isFile(library))) {
    log(`LiteRT-LM ${LITERTLM_RUNTIME_RELEASE.version} (${asset.fileName}) is already in ${options.dest}`);
    return library;
  }

  const archive = path.join(options.archiveDir ?? LITERTLM_VENDOR_DIR, asset.fileName);
  const stat = await fs.stat(archive).catch(() => null);
  if (!stat?.isFile()) throw new Error(`missing ${archive}`);
  const sha256 = await sha256Of(archive);
  if (stat.size !== asset.size || sha256 !== asset.sha256) {
    throw new Error(`${asset.fileName} does not match the registry: ${stat.size} bytes, sha256 ${sha256}`);
  }

  // 先解到旁边的临时目录，齐了再换掉旧的：中途失败不留下半个目录。
  const staging = `${options.dest}.staging`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  const names = await extractToolArchive(archive, asset.archive, staging);
  if (!names.includes(asset.executable)) throw new Error(`${asset.fileName} has no ${asset.executable}`);
  // 清单只列动态库：Worker 按扩展名找库，许可文件不交给它。
  const files = [];
  for (const name of names.filter((n) => path.extname(n) === path.extname(asset.executable)).sort()) {
    const file = path.join(staging, name);
    files.push({ path: name, size: (await fs.stat(file)).size, sha256: (await sha256Of(file))! });
  }
  const manifest = {
    format_version: 1,
    repo: LITERTLM_RUNTIME_COMPONENT.repo,
    revision: LITERTLM_RUNTIME_COMPONENT.revision,
    source: asset.fileName,
    files,
  };
  await fs.writeFile(path.join(staging, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(staging, STAMP), `${JSON.stringify(stamp)}\n`);
  await fs.rm(options.dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(options.dest), { recursive: true });
  await fs.rename(staging, options.dest);
  log(`LiteRT-LM ${LITERTLM_RUNTIME_RELEASE.version} (${asset.fileName}) -> ${options.dest}: ${names.sort().join(', ')}`);
  return library;
}

/** 开发时放库的 cargo 产物目录：`CARGO_TARGET_DIR`、`.cargo` 配置里的 `target-dir`，都没有时是仓库的 `target/`。 */
export function devTargetDir(): string {
  return cargoTargetDirs(ROOT).next().value ?? path.join(ROOT, 'target');
}

async function isFile(file: string): Promise<boolean> {
  return fs.stat(file).then(
    (s) => s.isFile(),
    () => false,
  );
}

async function sha256Of(file: string): Promise<string | null> {
  if (!(await isFile(file))) return null;
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string', default: process.platform },
      arch: { type: 'string', default: process.arch },
      out: { type: 'string' },
    },
  });
  if (!values.out && !bundlesLiteRtLm(values.platform!, values.arch!)) {
    console.log(`LiteRT-LM is not bundled for ${hostPlatformKey(values.platform!, values.arch!)}; nothing to do`);
    process.exit(0);
  }
  try {
    await fetchLiteRtLmRuntime({
      platform: values.platform!,
      arch: values.arch!,
      dest: values.out ? path.resolve(values.out) : path.join(devTargetDir(), LITERTLM_RUNTIME_RELEASE.name),
    });
  } catch (error) {
    console.error(`Cannot place the LiteRT-LM runtime library: ${(error as Error).message}`);
    process.exit(1);
  }
}
