// 构建戳（CLI 独立使用与发布 §7.4）：`npm run build:engine`、`build:wasm`、`build:web` 在产物旁写一份 `baocut-build.json`，
// 记下构建 commit（`repoBuild` 的写法：HEAD 短号，工作区有未提交改动时加 `-dirty`）、协议版本、构建时间，以及这次构建读过的每个
// 仓库内源文件的内容摘要。源码 Runtime 按摘要逐个比对此刻的源码（`packages/runtime-core/src/build-freshness.ts`），不一致就在
// `baocut version` 与 `status` 里警告并给出重建命令。比内容而不比 commit：无关的提交、换个 worktree 借用同一份产物都不算过期。
//
// 格式（schema 1）：
//   { schema: 1, component, build, protocolVersion, builtAt, outputs: [...], inputs: { "<仓库相对路径>": "<sha256 前 16 位>" } }

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BUILD_STAMP_FILE = 'baocut-build.json';

/** 文件内容的摘要：sha256 的前 16 位十六进制（Runtime 那边算法相同）。 */
export function hashFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  } catch {
    return null;
  }
}

/** 仓库此刻的构建号，与 `@baocut/runtime-storage` 的 `repoBuild` 相同；不是 git 仓库时 null。 */
export function repoBuild(root) {
  const head = git(root, ['rev-parse', '--short', 'HEAD'])?.trim();
  if (!head) return null;
  const status = git(root, ['status', '--porcelain', '--untracked-files=no']);
  return status === null || status.trim() === '' ? head : `${head}-dirty`;
}

/** 协议版本（`packages/protocol/src/wire.ts` 的 `PROTOCOL_VERSION`），按文本读：构建脚本不加载 TypeScript。 */
export function protocolVersion(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'packages', 'protocol', 'src', 'wire.ts'), 'utf8');
    return /export const PROTOCOL_VERSION = '([^']+)'/.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** cargo 的产物目录（可能被 `.cargo/config.local.toml` 挪走），向 cargo 要真实位置；失败时 null。 */
export function cargoTargetDir(root) {
  const metadata = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (metadata.status !== 0) return null;
  try {
    return JSON.parse(metadata.stdout).target_directory ?? null;
  } catch {
    return null;
  }
}

/**
 * cargo 的 dep-info（产物旁的 `<名字>.d`）：第一条规则的依赖就是编进这个产物的源文件（绝对路径，空格转义成 `\ `）。读不到时空。
 */
export function cargoDepInfo(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const rule = text.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'));
  if (!rule) return [];
  // 目标与依赖之间是 `: `（Windows 的盘符是 `C:\`，不会撞上）。
  const at = rule.indexOf(': ');
  if (at < 0) return [];
  return rule
    .slice(at + 2)
    .split(/(?<!\\) /)
    .map((token) => token.replaceAll('\\ ', ' ').trim())
    .filter(Boolean);
}

/**
 * Rust 产物的输入除了源文件还有清单：工作区的 `Cargo.toml`、`Cargo.lock`、工具链文件，以及每个源文件所在 crate 的 `Cargo.toml`
 * （feature 与依赖版本在那里）。
 */
export function withCargoManifests(root, inputs) {
  const result = new Set(inputs);
  for (const name of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'rust-toolchain']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) result.add(file);
  }
  const seen = new Set();
  for (const input of inputs) {
    for (let dir = path.dirname(path.resolve(input)); dir.startsWith(root) && dir !== root; dir = path.dirname(dir)) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const manifest = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(manifest)) {
        result.add(manifest);
        break;
      }
    }
  }
  return [...result];
}

/** 仓库相对的正斜杠路径；不在仓库里、在 `node_modules` 或排除目录里时 null。 */
function repoRelative(root, file, exclude) {
  const abs = path.resolve(file);
  if (exclude.some((dir) => abs === dir || abs.startsWith(dir + path.sep))) return null;
  const relative = path.relative(root, abs);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const posix = relative.split(path.sep).join('/');
  return posix.split('/').includes('node_modules') ? null : posix;
}

/**
 * 写构建戳。`inputs` 是绝对路径；仓库外的（cargo 注册表、系统文件）、`node_modules` 里的与 `exclude` 目录里的（cargo 产物目录里
 * 生成的源文件）不记。先写临时文件再改名，读的一方不会读到半份。
 */
export function writeBuildStamp({ root, file, component, inputs, outputs, exclude = [] }) {
  const excluded = exclude.map((dir) => path.resolve(dir));
  const hashes = new Map();
  for (const input of inputs) {
    const relative = repoRelative(root, input, excluded);
    if (!relative || hashes.has(relative)) continue;
    try {
      if (!fs.statSync(input).isFile()) continue;
      hashes.set(relative, hashFile(input));
    } catch {
      // 构建之后被删掉的输入不记：下次比对时它也不在。
    }
  }
  const stamp = {
    schema: 1,
    component,
    build: repoBuild(root),
    protocolVersion: protocolVersion(root),
    builtAt: new Date().toISOString(),
    outputs,
    inputs: Object.fromEntries([...hashes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(stamp, null, 1)}\n`);
  fs.renameSync(temp, file);
  return stamp;
}

/**
 * Vite 插件：生产构建写完产物后，在输出目录写构建戳。输入是这次构建图里的全部模块（含 `?inline` 引入的 `preview.wasm`、CSS），
 * 再加上 `extraInputs`（锁文件、配置文件）。
 */
export function buildStampPlugin({ root, component, extraInputs = [] }) {
  let outDir = null;
  let ids = [];
  return {
    name: 'baocut-build-stamp',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      ids = [...this.getModuleIds()]
        .filter((id) => !id.startsWith('\0'))
        .map((id) => id.replace(/[?#].*$/, ''))
        .filter((id) => path.isAbsolute(id));
    },
    // 产物写完才写戳（构建失败时 `closeBundle` 照样会被调用，不能用它）。
    writeBundle() {
      if (!outDir || ids.length === 0) return;
      writeBuildStamp({ root, file: path.join(outDir, BUILD_STAMP_FILE), component, inputs: [...ids, ...extraInputs], outputs: ['index.html'] });
    },
  };
}
