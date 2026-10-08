// 构建原生进程：视频引擎（engine-host）、Render Worker（export-worker）、speech-worker 与本地推理进程（model-worker）。
// model-worker 的推理后端随平台（架构设计 §6.5）：Apple Silicon 的 macOS 用默认 feature（MLX + Core ML）；
// 别的平台关掉默认 feature、开 candle 与 whisper.cpp 的 Whisper（`whisper-ggml`，构建要 CMake 与 C++ 编译器）。
// BAOCUT_WORKER_FEATURES（逗号分隔）再追加 feature，例如 NVIDIA 显卡上设 `cuda,whisper-ggml-cuda`（candle 与 Whisper 都走 CUDA，
// 要 CUDA Toolkit；没有 GPU 的构建机另设 CMAKE_CUDA_ARCHITECTURES），AMD / Intel 显卡上设 `whisper-ggml-vulkan`（要 Vulkan SDK）。
// 其余参数原样交给两次 cargo build（例如 `npm run build:engine -- --release`）。
// 两次构建都会跑完；任一失败时以非零退出，与 cargo 的 --keep-going 一致。

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCargo } from './cargo-path.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);

/** model-worker 的 feature 参数：Apple Silicon 的 macOS 保留默认，其余平台换成 candle 与 whisper-ggml；再加上环境变量里的。 */
function modelWorkerFeatureArgs(platform, arch, workerFeatures) {
  const added = (workerFeatures ?? '')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (platform === 'darwin' && arch === 'arm64') return added.length ? ['--features', added.join(',')] : [];
  const base = ['backend-candle', 'whisper-ggml'];
  return ['--no-default-features', '--features', [...base, ...added.filter((f) => !base.includes(f))].join(',')];
}

function cargo(args) {
  console.log(`> cargo ${args.join(' ')}`);
  const result = spawnSync('cargo', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status === 0;
}

ensureCargo();

// --no-default-features 作用于命令里的每个包，所以 model-worker 单独构建。
const engines = cargo(['build', '--keep-going', '-p', 'engine-host', '-p', 'export-worker', '-p', 'speech-worker', ...extra]);
const worker = cargo([
  'build',
  '-p',
  'model-worker',
  ...modelWorkerFeatureArgs(process.platform, process.arch, process.env.BAOCUT_WORKER_FEATURES),
  ...extra,
]);
if (!engines || !worker) process.exit(1);
