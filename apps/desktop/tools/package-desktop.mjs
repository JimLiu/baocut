// 桌面端打包：Windows x64 用 package:win* 出未签名 NSIS / ZIP；Apple Silicon 用 package:mac 出 Developer ID 签名、公证的 ZIP / DMG。
// 两个平台共用 staging 与 Runtime 资源布局。Mac 要 --build、--sign-sha1、全新输出目录与干净提交，签名流程在 macos-distribution.mjs。
// Mac 选项：--platform mac、--notary-profile、--sign-keychain、--metallib；Windows 专属选项与流程如下。
//
// 先要有：`npm run build`（out/）与 `npm run build:web`（apps/web/dist）；根的 package:win 脚本会先跑它们。
// 步骤：
// 1. 编 Worker：`cargo build --release --locked --target <三元组>`，Model Worker 按变体选后端（标准版 candle CPU 与 whisper.cpp 的
//    Whisper，CUDA 版的 candle 与 Whisper 都走 CUDA，Vulkan 版的 Whisper 改用 Vulkan）；
//    `--bin-dir <目录>` 改用已经编好的可执行文件（本机交叉编译的冒烟用）。
// 2. 在仓库外的临时目录里搭一个只含产物的应用：out/、按 out 里真正 require 的第三方包生成的 package.json 与它们的 node_modules。
//    不直接打 apps/desktop：它的 dependencies 里有工作区的 TypeScript 包与只给渲染进程用的 React，会被原样塞进 asar。
// 3. 资源按 `src/main/packaged-resources.ts`（主进程启动 Runtime 时用的同一份）放到 `<resources>` 下：bin/（Worker、凭据助手，
//    CUDA 版另带 NVIDIA 运行库）、templates/、skills/、agent-skills/、model-assets/、web/。都在 asar 外面，子进程要按路径读。
// 4. electron-builder 出包。它会把 Electron 的 win32-x64 发行包与 NSIS 工具下到自己的缓存目录（~/Library/Caches/electron-builder 等）。
// 5. 核对解开的包：resources 里的每一项都在，asar 里有主进程、Runtime 与 editor.wasm。在 Windows 上另由 check-packaged-app.mjs 真跑一遍。
// 6. 写发布报告 `<产物名>-release.json`：版本、build、变体、安装器与 zip 的文件名、大小与 sha256。给了 --download-base-url 时再按
//    应用的更新源格式（schema-1，app-update-rules.ts 的 releaseManifest）写 `appcast-<target>[-<变体>].json`，写完用应用自己的解析器读一遍。
//
// 选项：--variant cpu|cuda|vulkan（缺省 cpu）、--target <三元组>（缺省 x86_64-pc-windows-msvc）、--bin-dir <目录>、--cuda-redist <目录>
// （缺省 $CUDA_PATH/bin/x64 或 $CUDA_PATH/bin）、--worker-features <a,b>（Model Worker 另加的 feature）、--out <目录>（缺省 apps/desktop/dist/<变体>，
// 已被 .gitignore 忽略）、--targets nsis,zip、--keep-staging、--build <正整数>（发布的 build 号，写进应用的 package.json 与产物名；
// 不给时 build 是 0，应用不检查更新）、--download-base-url <https 地址>（安装器上传到哪个目录，要 --build 与 nsis）、
// --rollout-hours <n>（分批推送：自动检查在 n 小时内逐步放开，要 --download-base-url；更新源另写 `releasedAt` = 生成的时刻，
// 分批从这一刻算起。上传得晚就把它改成真正发布的时刻，它不在任何摘要里）。退出码：0 成功，1 失败。

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BUNDLE_ID, PRODUCT_NAME, feedFileName, feedTarget, parseManifest, releaseManifest } from '../src/main/app-update-rules.ts';
import { BUNDLED_EXECUTABLES, RESOURCE_DIRS } from '../src/main/packaged-resources.ts';
import { ensureCargo } from '../../../tools/cargo-path.mjs';
import { DISTRIBUTED_NOTICES } from '../../../tools/third-party-notices.ts';
import { distributeMac, runMac, signingPreflight } from './macos-distribution.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..');
const ROOT = path.resolve(DESKTOP, '../..');

/** 应用更新认的 bundle 标识；产品名决定 exe 与 NSIS 卸载程序的文件名（应用靠 `Uninstall BaoCut.exe` 认出安装版）。 */
const APP_ID = BUNDLE_ID;
/** 应用更新源的 target（应用按 win32 / x64 算出来的那个；与编 Worker 的 --target 无关）。 */
let FEED_TARGET;

/**
 * Model Worker 的后端，按显卡分三档：
 * - 标准版：全平台的 candle CPU 与 whisper.cpp 的 Whisper（CPU），没有合适显卡的机器用它。
 * - CUDA 版（NVIDIA 专用，Ampere / RTX 30 起）：candle 的 CUDA（`cuda`）与 Whisper 的 ggml CUDA 后端（`whisper-ggml-cuda`）两个 feature
 *   都开。exe 静态链接 ggml-cuda、动态链接 cudart / cublas，没有 NVIDIA 驱动的机器上起不来（candle 的 cudarc 同样如此）。
 * - Vulkan 版：Whisper 用 Vulkan GPU（AMD / Intel，以及不支持 CUDA 13 的 NVIDIA 显卡），candle 仍在 CPU 上（同 v2 的 Vulkan 版）。
 *   要构建机装 Vulkan SDK；运行时只要显卡驱动自带的 vulkan-1.dll，不随包。
 * 单一安装包在运行期自选 CUDA / Vulkan 现在做不到（架构设计 §14「单一 GPU 安装包在运行期自选后端」）。CUDA 版的 Whisper 与 Vulkan 版
 * 都未实测。不带 macOS 缺省的 MLX / CoreML。其余 Worker 用缺省 feature。
 */
const VARIANTS = {
  cpu: { suffix: '', modelWorkerFeatures: ['backend-candle', 'whisper-ggml'] },
  cuda: { suffix: '-cuda', modelWorkerFeatures: ['backend-candle', 'cuda', 'whisper-ggml-cuda'] },
  vulkan: { suffix: '-vulkan', modelWorkerFeatures: ['backend-candle', 'whisper-ggml-vulkan'] },
};

/**
 * CUDA 版随带的 NVIDIA 运行库（CUDA 13.x，放在 model-worker.exe 旁边，用户只需要显卡驱动）：cudart / cublas / curand / nvrtc，
 * cublas 会拉起 cublasLt，NVRTC 会加载 nvrtc-builtins。清单沿用 v2 的 Windows CUDA 发布（同为 candle 0.11）；工具链换了版本要跟着改。
 * Whisper 的 ggml-cuda（whisper-rs-sys 0.15，没开 GGML_STATIC）链的是 cudart、cublas（连带 cublasLt）与驱动的 cuda（nvcuda.dll，
 * 显卡驱动自带），都已在清单里或不随包，所以不用加库；按 whisper-rs-sys 的 build.rs 与 ggml-cuda 的 CMakeLists 核对，未实测
 * （工作流的 dumpbin 一步会列出实际依赖）。
 */
const CUDA_REDIST_DLLS = [
  'cudart64_13.dll',
  'cublas64_13.dll',
  'cublasLt64_13.dll',
  'curand64_10.dll',
  'nvrtc64_130_0.dll',
  'nvrtc-builtins64_131.dll',
];
const CUDA_NOTICE = [
  'This package bundles unmodified NVIDIA CUDA runtime libraries (the DLLs next',
  'to model-worker.exe). They are redistributed under the NVIDIA CUDA Toolkit End User',
  'License Agreement (https://docs.nvidia.com/cuda/eula/index.html) and are not',
  'covered by the BaoCut license.',
  'GPU inference requires an NVIDIA GPU with compute capability >= 8.0',
  '(Ampere / RTX 30 series or newer) and a recent NVIDIA driver.',
  'No CUDA Toolkit installation is required. Machines without such a GPU should',
  'use the standard package.',
  '',
].join('\n');

const { values: options } = parseArgs({
  options: {
    variant: { type: 'string', default: 'cpu' },
    platform: { type: 'string', default: 'win' },
    target: { type: 'string' },
    'sign-sha1': { type: 'string' },
    'notary-profile': { type: 'string', default: process.env.BAOCUT_NOTARY_PROFILE || 'baocut-notary' },
    'sign-keychain': { type: 'string' },
    metallib: { type: 'string' },
    'bin-dir': { type: 'string' },
    'cuda-redist': { type: 'string' },
    'worker-features': { type: 'string', default: '' },
    out: { type: 'string' },
    targets: { type: 'string' },
    'keep-staging': { type: 'boolean', default: false },
    build: { type: 'string' },
    'download-base-url': { type: 'string' },
    'rollout-hours': { type: 'string' },
  },
});

function fail(message) {
  console.error(`打包失败：${message}`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: false });
  if (result.error) fail(`${command} 起不来：${result.error.message}`);
  if (result.status !== 0) fail(`${command} 退出码 ${result.status}`);
}

/**
 * CUDA 版的 Whisper（ggml-cuda）编进哪些 GPU 架构，与 candle 的 `CUDA_COMPUTE_CAP=80` 同一口径：compute_80 的 PTX（Ampere 起，较新的
 * 显卡由驱动 JIT），再给 RTX 30 / 40 / 50 各编一份机器码（86、89、120；ggml 的 CMake 会把 120 改写成 120a，用上 Blackwell 专属指令）。
 * 必须显式给：外部设了 GGML_NATIVE=ON 时 ggml 会用 `native`，而构建机（CI 的 runner）没有 GPU，CMake 探到的架构是垃圾值，ggml 只好原样
 * 留着 `native`，nvcc 在没有 GPU 的机器上编不了。whisper-rs-sys 把 `CMAKE_*` 开头的环境变量原样交给 CMake，就靠这个传进去。未实测。
 */
const DEFAULT_CMAKE_CUDA_ARCHITECTURES = '80-virtual;86-real;89-real;120-real';

/**
 * 编 Model Worker 时的环境。三个变体都编 ggml-cpu（CUDA 与 Vulkan 版也有 CPU 的算子），都要关掉 `GGML_NATIVE`：它缺省是 ON，在 MSVC 上
 * 由 FindSIMD.cmake 在构建机上实际运行探测程序，探到 AVX-512 就给整个 ggml-cpu 加 `/arch:AVX512`，用户的 CPU 没有就非法指令崩溃。
 * 改成固定基线 AVX2（MSVC 上是 `/arch:AVX2` 加 FMA、F16C 与 BMI2，Haswell / Zen 起），显式给 `GGML_AVX2=ON` 是为了不依赖 ggml 的
 * 缺省推导（设了 `SOURCE_DATE_EPOCH` 时它会退到 SSE2）。外部设了就用外部的。whisper-rs-sys 把 `GGML_*` 环境变量交给 CMake，但不随它们
 * 重跑，换了值要先清掉它的构建产物（README「Windows 打包」）。未实测。
 *
 * CUDA 版另沿用 v2 的 Windows CUDA 发布：PTX 目标缺省 compute_80（Ampere 起，candle + CUDA 13 编不了更早的）；nvcc 的主机目标文件缺省是
 * 静态 CRT（/MT），与 Rust 的动态 CRT 不一致，Windows 上改成 /MD（ggml-cuda 经 CMake 调的 nvcc 同样吃到）。Whisper 的 ggml-cuda 另要
 * `CMAKE_CUDA_ARCHITECTURES`（外部给了就用外部的）。whisper-rs-sys 在 Windows 上还要 `CUDA_PATH` 找导入库（CUDA 安装器与工作流的
 * CUDA 安装步骤会设）。
 */
function modelWorkerBuildEnv() {
  const base = { ...process.env, GGML_NATIVE: process.env.GGML_NATIVE || 'OFF' };
  if (options.target.startsWith('x86_64-')) base.GGML_AVX2 = process.env.GGML_AVX2 || 'ON';
  if (options.variant !== 'cuda') return base;
  const env = {
    ...base,
    CUDA_COMPUTE_CAP: process.env.CUDA_COMPUTE_CAP || '80',
    CMAKE_CUDA_ARCHITECTURES: process.env.CMAKE_CUDA_ARCHITECTURES || DEFAULT_CMAKE_CUDA_ARCHITECTURES,
  };
  if (process.platform === 'win32') {
    const flags = env.NVCC_APPEND_FLAGS ?? '';
    if (/(?:^|[\s,="'])\/(?:MTd?|MDd)(?=$|[\s,"'])/i.test(`${env.NVCC_PREPEND_FLAGS ?? ''} ${flags}`)) {
      fail('NVCC_PREPEND_FLAGS / NVCC_APPEND_FLAGS 里有 /MT、/MTd 或 /MDd；CUDA 版要动态 CRT（/MD）');
    }
    if (!/(?:^|[\s,="'])\/MD(?=$|[\s,"'])/i.test(flags)) env.NVCC_APPEND_FLAGS = `${flags} -Xcompiler=/MD`.trim();
  }
  return env;
}

const isMac = options.platform === 'mac';
if (!['win', 'mac'].includes(options.platform)) fail('--platform must be win or mac');
options.target ??= isMac ? 'aarch64-apple-darwin' : 'x86_64-pc-windows-msvc';
options.targets ??= isMac ? 'dmg,zip' : 'nsis,zip';
FEED_TARGET = feedTarget(isMac ? 'darwin' : 'win32', isMac ? 'arm64' : 'x64');
const variant = VARIANTS[options.variant];
if (!variant) fail(`不认识的变体 ${options.variant}（cpu、cuda 或 vulkan）`);
if (isMac ? options.target !== 'aarch64-apple-darwin' : !options.target.includes('windows')) fail(`Unsupported target: ${options.target}`);
if (isMac && (process.platform !== 'darwin' || process.arch !== 'arm64' || options.variant !== 'cpu')) fail('macOS release requires native Apple Silicon and no Windows GPU variant');
const exe = (name) => isMac ? name : `${name}.exe`;
const outDir = path.resolve(options.out ?? path.join(DESKTOP, 'dist', isMac ? 'mac' : options.variant));
const packageTargets = options.targets.split(',').filter(Boolean);
const build = options.build === undefined || options.build === '' ? 0 : Number(options.build);
if (!Number.isInteger(build) || build < 0) fail(`--build 要正整数，收到 ${options.build}`);
const downloadBase = options['download-base-url'] || null;
if (downloadBase) {
  if (!/^https:\/\/[^\s?#]+$/.test(downloadBase)) fail(`--download-base-url 要不带查询参数的 https 地址，收到 ${downloadBase}`);
  if (build === 0) fail('--download-base-url 要同时给 --build');
  if (!isMac && !packageTargets.includes('nsis')) fail('--download-base-url 要出 nsis 安装器');
}
const rolloutHours = options['rollout-hours'] === undefined || options['rollout-hours'] === '' ? null : Number(options['rollout-hours']);
if (rolloutHours !== null) {
  if (!Number.isFinite(rolloutHours) || rolloutHours < 0) fail(`--rollout-hours 要不小于 0 的数，收到 ${options['rollout-hours']}`);
  if (!downloadBase) fail('--rollout-hours 要同时给 --download-base-url');
}

let sourceCommit = null;
if (isMac) {
  if (build === 0 || options.targets !== 'dmg,zip') fail('Mac release requires --build and --targets dmg,zip');
  if (existsSync(outDir) && readdirSync(outDir).length) fail('Mac release output directory must be new or empty');
  if (runMac('git', ['status', '--porcelain=v1', '--untracked-files=all']).trim()) fail('Commit source changes before building a Mac release');
  sourceCommit = runMac('git', ['rev-parse', 'HEAD']).trim();
  signingPreflight(options['sign-sha1'], options['notary-profile'], options['sign-keychain']);
}

for (const required of [
  'out/main/index.js',
  'out/main/runtime.js',
  'out/main/generated/editor.wasm',
  'out/preload/index.js',
  'out/renderer/index.html',
]) {
  if (!existsSync(path.join(DESKTOP, required))) fail(`没有 apps/desktop/${required}：先运行 npm run build`);
}
if (!existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) fail('没有 apps/web/dist/index.html：先运行 npm run build:web');

// 1. Worker。
let binSource;
if (options['bin-dir']) {
  binSource = path.resolve(options['bin-dir']);
} else {
  ensureCargo();
  const cargo = ['build', '--release', '--locked', '--target', options.target];
  run('cargo', [...cargo, ...BUNDLED_EXECUTABLES.filter((name) => name !== 'model-worker').flatMap((name) => ['-p', name])]);
  const features = [...(isMac ? [] : variant.modelWorkerFeatures), ...options['worker-features'].split(',').filter(Boolean)];
  run('cargo', [...cargo, '-p', 'model-worker', ...(isMac ? [] : ['--no-default-features']), ...(features.length ? ['--features', features.join(',')] : [])], isMac ? process.env : modelWorkerBuildEnv());
  const metadata = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (metadata.status !== 0) fail(`cargo metadata：${metadata.stderr}`);
  binSource = path.join(JSON.parse(metadata.stdout).target_directory, options.target, 'release');
}

const staging = mkdtempSync(path.join(tmpdir(), 'baocut-package-'));
const appDir = path.join(staging, 'app');
const resDir = path.join(staging, 'resources');
try {
  // 2. 只含产物的应用。
  const desktop = JSON.parse(readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
  mkdirSync(appDir, { recursive: true });
  cpSync(path.join(ROOT, 'LICENSE'), path.join(appDir, 'LICENSE'));
  cpSync(path.join(DESKTOP, 'out'), path.join(appDir, 'out'), { recursive: true });
  const externals = externalPackages(path.join(appDir, 'out'), desktop.dependencies ?? {});
  const dependencies = {};
  for (const name of externals) {
    const dir = resolvePackage(name, ROOT);
    dependencies[name] = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  }
  copyClosure(externals, ROOT, path.join(appDir, 'node_modules'));
  writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'baocut',
        productName: PRODUCT_NAME,
        version: desktop.version,
        description: 'BaoCut',
        author: { name: PRODUCT_NAME },
        license: 'SEE LICENSE IN LICENSE',
        main: 'out/main/index.js',
        // 应用更新读这两个（app-update-ipc.ts）：build 号比清单，变体决定读哪一份更新源。没有 build 号的包不检查更新。
        ...(build > 0 ? { baocutBuild: build } : {}),
        ...(isMac ? { baocutSourceCommit: sourceCommit } : {}),
        baocutVariant: options.variant,
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `应用的第三方依赖：${
      Object.entries(dependencies)
        .map(([n, v]) => `${n}@${v}`)
        .join('、') || '无'
    }`,
  );

  // 3. 资源。
  const bin = path.join(resDir, RESOURCE_DIRS.bin);
  mkdirSync(bin, { recursive: true });
  for (const name of BUNDLED_EXECUTABLES) {
    const file = path.join(binSource, exe(name));
    if (!existsSync(file)) fail(`没有 ${file}`);
    cpSync(file, path.join(bin, exe(name)));
  }
  if (options.variant === 'cuda') {
    const cudaPath = process.env.CUDA_PATH;
    const redist =
      options['cuda-redist'] ??
      (cudaPath ? [path.join(cudaPath, 'bin', 'x64'), path.join(cudaPath, 'bin')].find((dir) => existsSync(dir)) : undefined);
    if (!redist) fail('CUDA 版要 --cuda-redist <目录> 或 CUDA_PATH');
    for (const dll of CUDA_REDIST_DLLS) {
      const file = path.join(redist, dll);
      if (!existsSync(file) || statSync(file).size === 0) fail(`没有 CUDA 运行库 ${file}`);
      cpSync(file, path.join(bin, dll));
    }
    writeFileSync(path.join(bin, 'CUDA-RUNTIME-NOTICE.txt'), CUDA_NOTICE);
  }
  if (isMac) {
    const buildDir = path.join(binSource, 'build');
    const candidates = existsSync(buildDir) ? readdirSync(buildDir).filter((name) => name.startsWith('pmetal-mlx-sys-')).map((name) => path.join(buildDir, name, 'out/build/lib/mlx.metallib')).filter((file) => existsSync(file)) : [];
    const metallib = options.metallib || (candidates.length === 1 ? candidates[0] : null);
    if (!metallib || !existsSync(metallib)) fail('Require exactly one release mlx.metallib or pass --metallib from the same build');
    cpSync(metallib, path.join(bin, 'mlx.metallib'));
  }
  cpSync(path.join(ROOT, 'templates'), path.join(resDir, RESOURCE_DIRS.templates), { recursive: true });
  cpSync(path.join(ROOT, 'skills'), path.join(resDir, RESOURCE_DIRS.skills), { recursive: true });
  cpSync(path.join(ROOT, 'agent-skills'), path.join(resDir, RESOURCE_DIRS.agentSkills), { recursive: true });
  cpSync(path.join(ROOT, 'packages/models/assets'), path.join(resDir, RESOURCE_DIRS.modelAssets), { recursive: true });
  cpSync(path.join(ROOT, 'apps/web/dist'), path.join(resDir, RESOURCE_DIRS.web), { recursive: true });

  // 4. electron-builder。
  const { build: buildElectron, Platform, Arch } = await import('electron-builder');
  const electronVersion = JSON.parse(readFileSync(path.join(resolvePackage('electron', ROOT), 'package.json'), 'utf8')).version;
  const onWindows = process.platform === 'win32';
  const buildPart = build > 0 ? `-build.${build}` : '';
  const artifact = `${PRODUCT_NAME}-\${version}${buildPart}-${isMac ? 'aarch64-apple-darwin' : `win-x64${variant.suffix}`}`;
  await buildElectron({
    projectDir: appDir,
    targets: isMac ? Platform.MAC.createTarget(['dir'], Arch.arm64) : Platform.WINDOWS.createTarget(packageTargets, Arch.x64),
    publish: 'never',
    config: {
      appId: APP_ID,
      productName: PRODUCT_NAME,
      electronVersion,
      directories: { output: outDir, buildResources: path.join(DESKTOP, 'build') },
      // 没有原生 Node 模块；第三方依赖已经搭好，不重装、不重编。
      npmRebuild: false,
      nodeGypRebuild: false,
      asar: true,
      files: ['out/**', 'package.json', 'LICENSE'],
      extraResources: [
        ...Object.values(RESOURCE_DIRS).map((dir) => ({ from: path.join(resDir, dir), to: dir })),
        ...DISTRIBUTED_NOTICES.map(({ source, fileName }) => ({ from: path.join(ROOT, source), to: fileName })),
      ],
      // 不改 Electron 的 fuse：渲染进程靠 GrantFileProtocolExtraPrivileges 读 file:// 的模块与字体，Runtime 靠 RunAsNode 以
      // Node 方式启动（架构设计 §9.1 的字体一节）。要关就得先把渲染进程改由自定义协议供给。
      mac: {
        icon: path.join(DESKTOP, 'build', 'icon.icns'),
        category: 'public.app-category.video',
        minimumSystemVersion: '14.0',
        bundleVersion: String(build),
        identity: null,
        notarize: false,
        extendInfo: {
          NSLocalNetworkUsageDescription: 'BaoCut discovers and connects to local compute devices for transcription and generation.',
          NSMicrophoneUsageDescription: 'BaoCut needs microphone access to record audio for transcription.',
          NSBonjourServices: ['_baocut-node._tcp'],
        },
        extraFiles: [{ from: path.join(DESKTOP, 'build/localizations'), to: 'Resources' }],
      },
      win: {
        icon: path.join(DESKTOP, 'build', 'icon.ico'),
        artifactName: `${artifact}.\${ext}`,
        // 不签名（§14）。改 exe 的图标与版本信息要 rcedit，在 macOS / Linux 上得有 Wine：只在 Windows 上做。
        signAndEditExecutable: onWindows,
      },
      nsis: {
        oneClick: true,
        perMachine: false,
        artifactName: `${artifact}-setup.\${ext}`,
        deleteAppDataOnUninstall: false,
      },
    },
  });

  // 5. 核对解开的包。
  const unpacked = isMac ? path.join(outDir, 'mac-arm64', `${PRODUCT_NAME}.app`) : path.join(outDir, 'win-unpacked');
  verifyUnpacked(unpacked, options.variant);
  for (const name of readdirSync(outDir)) {
    const file = path.join(outDir, name);
    if (statSync(file).isFile() && /\.(exe|zip)$/.test(name))
      console.log(`产物：${file}（${Math.round(statSync(file).size / 2 ** 20)} MB）`);
  }

  // 6. 发布报告与更新源。
  if (isMac) {
    const stem = `${PRODUCT_NAME}-${desktop.version}${buildPart}-aarch64-apple-darwin`;
    const distribution = await distributeMac({ app: unpacked, output: outDir, stem, version: desktop.version, build, appId: APP_ID,
      signingSha1: options['sign-sha1'], profile: options['notary-profile'], keychain: options['sign-keychain'],
      executables: BUNDLED_EXECUTABLES.map((name) => path.join(unpacked, 'Contents/Resources/bin', name)),
      entitlements: path.join(DESKTOP, 'build/entitlements.mac.plist') });
    run(process.execPath, [path.join(HERE, 'check-packaged-app.mjs'), distribution.verifiedApp]);
    const report = { schema: 1, product: PRODUCT_NAME, appId: APP_ID, version: desktop.version, build, target: FEED_TARGET,
      sourceCommit, minimumSystemVersion: '14.0', ...distribution };
    writeFileSync(path.join(outDir, 'app-release.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (downloadBase) {
      const manifest = releaseManifest({ target: FEED_TARGET, variant: 'cpu', version: desktop.version, build, date: new Date().toISOString().slice(0, 10),
        format: 'zip', url: `${downloadBase.replace(/\/+$/, '')}/${distribution.portable.file}`, size: distribution.portable.size, sha256: distribution.portable.sha256 });
      const text = `${JSON.stringify(manifest, null, 2)}\n`;
      if (!parseManifest(text, FEED_TARGET, false).ok) fail('Mac appcast validation failed');
      writeFileSync(path.join(outDir, feedFileName(FEED_TARGET, null)), text);
    }
  } else writeReleaseFiles(`${PRODUCT_NAME}-${desktop.version}${buildPart}-win-x64${variant.suffix}`, desktop.version);
} finally {
  if (options['keep-staging']) console.log(`临时目录留着：${staging}`);
  else rmSync(staging, { recursive: true, force: true });
}

/** 文件的大小与 sha256（流式读，安装器上百 MB）。 */
function fileFacts(file) {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  let size = 0;
  try {
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      size += read;
    }
  } finally {
    closeSync(fd);
  }
  return { file: path.basename(file), size, sha256: hash.digest('hex') };
}

/**
 * 发布报告（总是写）与更新源（给了 --download-base-url 才写）。更新源用应用自己的 releaseManifest 生成、parseManifest 读回，
 * 与应用检查更新时读的是同一套口径。
 */
function writeReleaseFiles(stem, version) {
  const installerPath = path.join(outDir, `${stem}-setup.exe`);
  const zipPath = path.join(outDir, `${stem}.zip`);
  const installer = packageTargets.includes('nsis') ? fileFacts(installerPath) : null;
  const portable = packageTargets.includes('zip') ? fileFacts(zipPath) : null;
  const report = {
    schema: 1,
    product: PRODUCT_NAME,
    appId: APP_ID,
    version,
    build,
    target: FEED_TARGET,
    variant: options.variant,
    unsigned: true,
    installer: installer && { format: 'exe', ...installer },
    portable: portable && { format: 'zip', ...portable },
    feed: feedFileName(FEED_TARGET, options.variant),
  };
  const reportPath = path.join(outDir, `${stem}-release.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`发布报告：${reportPath}`);
  if (!downloadBase) return;
  const generatedAt = new Date();
  const manifest = releaseManifest({
    target: FEED_TARGET,
    variant: options.variant,
    version,
    build,
    date: generatedAt.toISOString().slice(0, 10),
    format: 'exe',
    url: `${downloadBase.replace(/\/+$/, '')}/${encodeURIComponent(installer.file)}`,
    size: installer.size,
    sha256: installer.sha256,
    ...(rolloutHours ? { rolloutHours, releasedAt: generatedAt.toISOString() } : {}),
  });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  const parsed = parseManifest(text, FEED_TARGET, false, options.variant);
  if (!parsed.ok) fail(`生成的更新源读不回来：${parsed.error} ${parsed.detail}`);
  if (rolloutHours && !parsed.rollout) fail('生成的更新源里的分批字段读不回来');
  const feedPath = path.join(outDir, report.feed);
  writeFileSync(feedPath, text);
  console.log(`更新源：${feedPath}`);
}

/** out/main 与 out/preload 里真正 require 的第三方包（只认 apps/desktop 的 dependencies 里列着的，代码里的字符串不算）。 */
function externalPackages(outDir, declared) {
  const builtins = new Set(builtinModules);
  const found = new Set();
  for (const sub of ['main', 'preload']) {
    for (const file of listFiles(path.join(outDir, sub)).filter((f) => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:require\(|from\s+|import\()\s*["']([^"'./][^"']*)["']/g)) {
        const spec = match[1];
        if (spec.startsWith('node:') || builtins.has(spec) || spec === 'electron') continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (name in declared && !name.startsWith('@baocut/')) found.add(name);
      }
    }
  }
  return [...found].sort();
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

/** 按 Node 的办法从目录 `from` 往上找 `node_modules/<name>`（不经 exports，有的包不导出 package.json）。 */
function resolvePackage(name, from, optional = false) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) break;
  }
  if (optional) return null;
  fail(`找不到依赖 ${name}`);
}

/** 把这些包与它们的依赖（生产依赖与装了的可选依赖）复制成扁平的 node_modules。版本冲突时直接失败，不猜。 */
function copyClosure(names, fromDir, toModules) {
  const seen = new Map();
  const queue = names.map((name) => ({ name, from: fromDir }));
  while (queue.length > 0) {
    const { name, from } = queue.shift();
    const dir = resolvePackage(name, from);
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (seen.has(name)) {
      if (seen.get(name) !== manifest.version) fail(`${name} 有两个版本（${seen.get(name)}、${manifest.version}），要改成嵌套复制`);
      continue;
    }
    seen.set(name, manifest.version);
    cpSync(dir, path.join(toModules, name), { recursive: true, dereference: true });
    for (const dep of Object.keys(manifest.dependencies ?? {})) queue.push({ name: dep, from: dir });
    // 没装的可选依赖不带。
    for (const dep of Object.keys(manifest.optionalDependencies ?? {}))
      if (resolvePackage(dep, dir, true)) queue.push({ name: dep, from: dir });
  }
}

/** 解开的包里应有的东西：与主进程交给 Runtime 的位置（packaged-resources.ts）逐项对上。 */
function verifyUnpacked(dir, variantName) {
  const problems = [];
  const resources = path.join(dir, isMac ? 'Contents/Resources' : 'resources');
  for (const { source, fileName } of DISTRIBUTED_NOTICES) {
    const file = path.join(resources, fileName);
    if (!existsSync(file)) problems.push(`没有 resources/${fileName}`);
    else if (!readFileSync(file).equals(readFileSync(path.join(ROOT, source)))) problems.push(`resources/${fileName} 与源码声明不一致`);
  }
  if (!existsSync(path.join(dir, isMac ? `Contents/MacOS/${PRODUCT_NAME}` : `${PRODUCT_NAME}.exe`))) problems.push(`没有 ${PRODUCT_NAME}.exe`);
  for (const name of BUNDLED_EXECUTABLES) {
    if (!existsSync(path.join(resources, RESOURCE_DIRS.bin, exe(name)))) problems.push(`没有 resources/${RESOURCE_DIRS.bin}/${exe(name)}`);
  }
  if (variantName === 'cuda') {
    for (const dll of CUDA_REDIST_DLLS) if (!existsSync(path.join(resources, RESOURCE_DIRS.bin, dll))) problems.push(`没有 ${dll}`);
  }
  for (const sub of Object.values(RESOURCE_DIRS)) if (!existsSync(path.join(resources, sub))) problems.push(`没有 resources/${sub}`);
  if (!existsSync(path.join(resources, RESOURCE_DIRS.web, 'index.html'))) problems.push('没有 resources/web/index.html');
  const asar = path.join(resources, 'app.asar');
  if (!existsSync(asar)) problems.push('没有 resources/app.asar');
  else {
    const entries = new Set(asarEntries(asar));
    for (const entry of [
      '/package.json',
      '/LICENSE',
      '/out/main/index.js',
      '/out/main/runtime.js',
      '/out/main/generated/editor.wasm',
      '/out/preload/index.js',
      '/out/renderer/index.html',
    ]) {
      if (!entries.has(entry)) problems.push(`asar 里没有 ${entry}`);
    }
  }
  if (problems.length > 0) fail(`解开的包不对：\n- ${problems.join('\n- ')}`);
  console.log(`解开的包核对通过：${dir}`);
}

/** asar 的文件清单（头是 Chromium Pickle 包着的 JSON：第 12 字节起是它的长度，第 16 字节起是它）。 */
function asarEntries(file) {
  const fd = openSync(file, 'r');
  let header;
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    const json = Buffer.alloc(prefix.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 16);
    header = JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
  const entries = [];
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const full = `${prefix}/${name}`;
      if (child.files) walk(child, full);
      else entries.push(full);
    }
  };
  walk(header, '');
  return entries;
}
