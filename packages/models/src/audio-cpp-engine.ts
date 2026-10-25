import path from 'node:path';
import type { ComponentRelease, ComponentReleaseAsset } from './bundle-registry.ts';

/**
 * 内置的 audio.cpp 引擎（架构设计 §6.3、§6.5；Model Worker 协议规范 §4.4）：本地语音合成与本地音乐生成共用的推理引擎，随应用分发，
 * 不另外下载。合成用常驻的 `audiocpp_server`（每个用到的模型包一个进程，空闲时退出），音乐每个任务起一个 `audiocpp_cli`。
 *
 * 位置：打包后在 `<resources>/bin/audiocpp/`；开发时在 cargo 产物目录的 `audiocpp/`（`npm run build:audiocpp` 按这里的登记下载、
 * 核对、解开）。`BAOCUT_AUDIOCPP_CLI` 指向自己构建的 `audiocpp_cli` 时只用它，`audiocpp_server` 取同目录的。
 *
 * 发布物：上游 GitHub Releases（https://github.com/0xShug0/audio.cpp/releases）每个版本按平台出一个压缩包，可执行文件在包的根目录，
 * Linux 包旁边还有 `libggml*.so`，Windows 包旁边有 MSVC 运行库 DLL，所以只解开根目录的普通文件（`archive.skip` 里的同包工具不解开）。
 * 各平台选：
 * - macOS（arm64、x64）：`metal` 包，静态链接，只依赖系统框架。
 * - Windows x64、Linux x64：`vulkan-portable` 包（非 portable 的包按 GitHub 构建机的 CPU 开了 AVX-512，别的机器可能崩溃）；Windows 的
 *   `cpu` 安装包与 Linux 的 CPU 构建用 `cpu-portable` 包。CUDA 包连运行库要 0.8–1.1 GB，不用：Windows 的 `cuda` 安装包同样带
 *   `vulkan-portable`，NVIDIA 显卡经 Vulkan 加速。Vulkan 包启动时要系统里有 Vulkan 加载器（显卡驱动带的 `vulkan-1.dll`、
 *   `libvulkan.so.1`），没有时引擎起不来。
 * - Linux arm64、Windows arm64：上游没有发布，这样的主机上本地合成与音乐不可用，只能自己构建后用 `BAOCUT_AUDIOCPP_CLI` 指定。
 *
 * 不随引擎分发：`model_specs/`（模型包的 GGUF 自带规格）、eSpeak-ng 与 MeCab（引擎运行时按需 `dlopen`，这里用到的模型族都不需要）。
 * 大小与 sha256 取自 2026-10-22 上游 Releases API 给出的 `digest`；macOS arm64 的包在本机下载后重新算过，一致。
 * 许可：上游 `LICENSE` 是 Apache-2.0（Copyright 2026 ShugoAI LLC），静态链接的第三方组件见 `THIRD_PARTY_NOTICES.md` 与随应用分发的
 * `packages/models/licenses/audio.cpp.txt`。模型权重的许可另算，见 `speech-bundles.ts`、`music-bundles.ts`。
 */

/** 引擎所在的目录名（`<resources>/bin/audiocpp/`、`<cargo target>/audiocpp/`），也是镜像路径里的名字。 */
export const AUDIO_CPP_TOOL = 'audiocpp';

/** 命令行引擎的名字（不带 `.exe`）：音乐每个任务一个进程。 */
export const AUDIO_CPP_COMMAND = 'audiocpp_cli';

/** 常驻服务的名字（不带 `.exe`）：语音合成每个模型包一个进程。 */
export const AUDIO_CPP_SERVER = 'audiocpp_server';

/** 引擎可执行文件的环境变量：给了就只用它（开发时指向自己构建的 `audiocpp_cli`，`audiocpp_server` 取同目录的），不找内置的。 */
export const AUDIO_CPP_CLI_ENV = 'BAOCUT_AUDIOCPP_CLI';

/**
 * 引擎后端的环境变量（`metal` / `cuda` / `vulkan` / `cpu`）：不给时命令行引擎自己选，合成服务按构建编进去的后端选
 * （`audioCppServerBackend`）。
 */
export const AUDIO_CPP_BACKEND_ENV = 'BAOCUT_AUDIOCPP_BACKEND';

const POSIX_SKIP = ['audiocpp_gguf'];
const WINDOWS_SKIP = ['audiocpp_gguf.exe'];

function posix(fileName: string, size: number, sha256: string): ComponentReleaseAsset {
  return { fileName, size, sha256, archive: { format: 'tar.gz', skip: POSIX_SKIP }, executable: AUDIO_CPP_COMMAND };
}

function windows(fileName: string, size: number, sha256: string): ComponentReleaseAsset {
  return { fileName, size, sha256, archive: { format: 'zip', skip: WINDOWS_SKIP }, executable: `${AUDIO_CPP_COMMAND}.exe` };
}

/** 内置引擎的版本与各平台的压缩包。平台键是 `<platform>-<arch>`，CPU 构建另加 `-cpu`（`audioCppAssetKey`）。 */
export const AUDIO_CPP_RELEASE: ComponentRelease = {
  name: AUDIO_CPP_TOOL,
  version: '0.9.2-drama3-base-small',
  // 上游的标签带 `v`，版本号（`--version` 打印的）不带。
  urlTemplate: 'https://github.com/0xShug0/audio.cpp/releases/download/v{version}/{file}',
  assets: {
    'darwin-arm64': posix(
      'audio-v0.9.2-drama3-base-small-bin-macos-arm64-metal.tar.gz',
      32708971,
      '1281998c1acd170a7d92139853fe6ce6ab920e211d2ad3359775d43ad9ba616d',
    ),
    'darwin-x64': posix(
      'audio-v0.9.2-drama3-base-small-bin-macos-x64-metal.tar.gz',
      34649590,
      'e4f1bca78339092c679bb51b90c895bdef6b2e6658eef467879f89c78a3941f0',
    ),
    'linux-x64': posix(
      'audio-v0.9.2-drama3-base-small-bin-ubuntu-x64-vulkan-portable.tar.gz',
      74761470,
      'dfd0ad832829210eb13a03779bdd90f3e6e68f68edf762bf25b3915067beeb73',
    ),
    'linux-x64-cpu': posix(
      'audio-v0.9.2-drama3-base-small-bin-ubuntu-x64-cpu-portable.tar.gz',
      61000844,
      'd5e6110daae50800429680a277b70557d333d552c4a130a8f1d0e56181fa8697',
    ),
    'win32-x64': windows(
      'audio-v0.9.2-drama3-base-small-bin-windows-x64-vulkan-portable.zip',
      63227361,
      '9c943d406af3543cc5005d158ed583210cd7a13371bffcd4b7f262f7a6a5ad16',
    ),
    'win32-x64-cpu': windows(
      'audio-v0.9.2-drama3-base-small-bin-windows-x64-cpu-portable.zip',
      28786884,
      '9654c8f66f87bda768196d934059be896399b43703b06e5f2b857430775bec3b',
    ),
  },
};

/**
 * 一台主机（或一个安装包）用哪个压缩包：`<platform>-<arch>`；`variant` 是 `cpu`（Windows 的 CPU 安装包、Linux 的 CPU 构建）且有
 * CPU 构建时加 `-cpu`。其余变体（`cuda`、`vulkan`、没有）用默认的包。
 */
export function audioCppAssetKey(platform: string, arch: string, variant?: string | null): string {
  const key = `${platform}-${arch}`;
  return variant === 'cpu' && AUDIO_CPP_RELEASE.assets[`${key}-cpu`] ? `${key}-cpu` : key;
}

/** `audiocpp_server` 的路径：与 `audiocpp_cli` 在同一目录。 */
export function audioCppServerOf(cli: string): string {
  const ext = path.extname(cli);
  return path.join(path.dirname(cli), `${AUDIO_CPP_SERVER}${ext.toLowerCase() === '.exe' ? '.exe' : ''}`);
}

/** 合成服务优先用的后端：有 GPU 后端时用它（构建里只会有其中一种），都没有时 `cpu`。 */
const SERVER_BACKEND_ORDER = ['metal', 'cuda', 'vulkan', 'hip'];

/**
 * 合成服务（`audiocpp_server`）用哪个后端：`--version` 的 `backends:` 行列出构建编进去的后端（如 `cpu,metal`），取
 * `SERVER_BACKEND_ORDER` 里第一个有的，都没有时 `cpu`。服务不给后端时默认 `cuda`，不带 CUDA 的构建（macOS 的 Metal 包、
 * Windows 与 Linux 的 Vulkan 包和 CPU 包）起不来，所以总要给；读不出 `backends:` 行时也给 `cpu`。
 */
export function audioCppServerBackend(versionOutput: string): string {
  const line = /^\s*backends:\s*(.+)$/m.exec(versionOutput)?.[1] ?? '';
  const backends = new Set(line.split(',').map((name) => name.trim().toLowerCase()));
  return SERVER_BACKEND_ORDER.find((name) => backends.has(name)) ?? 'cpu';
}

/**
 * 从 `audiocpp_cli --version` 的输出取版本：第一行是 `audio.cpp <版本>`（发布构建保留完整版本后缀，自己构建没给版本时是 `dev`）。
 */
export function parseAudioCppVersion(output: string): string | null {
  return /^\s*audio\.cpp\s+v?(\S+)/m.exec(output)?.[1] ?? null;
}
