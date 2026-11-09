// 构建原生进程：视频引擎（engine-host）、Render Worker（export-worker）、speech-worker、人脸检测（face-detect）、抠像（matte）与本地推理进程（model-worker）。
// model-worker 的推理后端随平台（架构设计 §6.5）：Apple Silicon 的 macOS 用默认 feature（MLX + Core ML + LiteRT-LM）；
// 别的平台关掉默认 feature、开 candle、whisper.cpp 的 Whisper（`whisper-ggml`，构建要 CMake 与 C++ 编译器）与 LiteRT-LM 的文本嵌入
// （`backend-litert`，运行期才打开 C 库，构建不要额外的工具链；Windows 的 C 库由 `npm run build:litertlm-runtime` 放好）。
// BAOCUT_WORKER_FEATURES（逗号分隔）再追加 feature，例如 NVIDIA 显卡上设 `cuda,whisper-ggml-cuda`（candle 与 Whisper 都走 CUDA，
// 要 CUDA Toolkit；没有 GPU 的构建机另设 CMAKE_CUDA_ARCHITECTURES），AMD / Intel 显卡上设 `whisper-ggml-vulkan`（要 Vulkan SDK）。
// 其余参数原样交给两次 cargo build（例如 `npm run build:engine -- --release`）。
// 两次构建都会跑完；任一失败时以非零退出，与 cargo 的 --keep-going 一致。
// 都成功后在产物目录写构建戳（`baocut-build.json`，CLI 独立使用与发布 §7.4），源码 Runtime 据此判断 Worker 是否比源码旧。

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_STAMP_FILE, cargoDepInfo, cargoTargetDir, withCargoManifests, writeBuildStamp } from './build-stamp.mjs';
import { ensureCargo } from './cargo-path.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extra = process.argv.slice(2);

/** model-worker 的 feature 参数：Apple Silicon 的 macOS 保留默认，其余平台换成 candle、whisper-ggml 与 backend-litert；再加上环境变量里的。 */
function modelWorkerFeatureArgs(platform, arch, workerFeatures) {
  const added = (workerFeatures ?? '')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
  if (platform === 'darwin' && arch === 'arm64') return added.length ? ['--features', added.join(',')] : [];
  const base = ['backend-candle', 'whisper-ggml', 'backend-litert'];
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
const ENGINE_BINARIES = ['engine-host', 'export-worker', 'speech-worker', 'face-detect', 'matte'];
const engines = cargo(['build', '--keep-going', ...ENGINE_BINARIES.flatMap((name) => ['-p', name]), ...extra]);
const worker = cargo([
  'build',
  '-p',
  'model-worker',
  ...modelWorkerFeatureArgs(process.platform, process.arch, process.env.BAOCUT_WORKER_FEATURES),
  ...extra,
]);
if (!engines || !worker) process.exit(1);

/** 产物所在的目录：`--release` 是 release，`--profile <名字>` 是那个名字（dev 落在 debug），带 `--target` 时多一层目标三元组。 */
function profileDir(targetDir, args) {
  const option = (name) => {
    const at = args.indexOf(name);
    if (at >= 0) return args[at + 1] ?? null;
    return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  };
  const profile = option('--profile') ?? (args.includes('--release') || args.includes('-r') ? 'release' : 'dev');
  const dir = profile === 'dev' || profile === 'test' ? 'debug' : profile === 'bench' ? 'release' : profile;
  const triple = option('--target');
  return triple ? join(targetDir, triple, dir) : join(targetDir, dir);
}

const targetDir = cargoTargetDir(root);
if (targetDir) {
  const dir = profileDir(targetDir, extra);
  const binaries = [...ENGINE_BINARIES, 'model-worker'];
  const inputs = binaries.flatMap((name) => cargoDepInfo(join(dir, `${name}.d`)));
  writeBuildStamp({
    root,
    file: join(dir, BUILD_STAMP_FILE),
    component: 'workers',
    inputs: withCargoManifests(root, inputs),
    outputs: binaries,
    exclude: [targetDir],
  });
  console.log(`build stamp: ${join(dir, BUILD_STAMP_FILE)}`);
} else {
  console.warn('cargo metadata failed; no build stamp written');
}
