import { ffmpegMissingRemedyMessage } from '@baocut/process-host';
import { refOf, type ExternalToolOffer, type Localized } from '@baocut/protocol';
import type { ToolUpdateRecipe } from './tool-update-plan.ts';
import { RcExternalTools, RcGit } from '@baocut/protocol/messages/runtime-core';
import { macosGitUsable } from './git-probe.ts';

/**
 * 受管外部工具的登记表（架构设计 §12.9）。每个工具一份清单：用途、最低版本、探测方式，能由 BaoCut 下载的再带固定的发布版本、
 * 各平台的文件、大小、sha256 与许可。本地语音合成与音乐生成用的 audio.cpp 引擎不在这里：它随应用内置，不另外下载（`@baocut/models`
 * 的 `audio-cpp-engine.ts`，Model Worker 协议规范 §4.4）。
 *
 * 不编造摘要：离线无法核实的 sha256 与大小留空（null），这时安装以 `TOOL_MANIFEST_INCOMPLETE` 拒绝（与模型包的内置清单
 * `MODEL_MANIFEST_INCOMPLETE` 同一条规则）。补上摘要是待评审事项（§14）。
 */

/** 一个平台要下载的文件。 */
export interface ToolAsset {
  /** 发布里的文件名。 */
  fileName: string;
  /** 字节数；未知时 null。 */
  size: number | null;
  /** sha256（小写十六进制）；未知时 null，不能安装。 */
  sha256: string | null;
  /**
   * 发布文件是压缩包时的格式：核对之后只解开包根目录里的普通文件到 `tools/<工具>/<版本>/`（`skip` 里的不解开；`dirs` 里的子目录
   * 连同其中直接的文件一并解开，例如可执行文件旁边的模型），可执行文件是其中的 `command`。没有时发布文件本身就是可执行文件。
   */
  archive?: { format: 'tar.gz' | 'zip'; skip: readonly string[]; dirs?: readonly string[] };
}

export interface ToolRelease {
  /** 固定的发布版本（发布页的标签）。 */
  version: string;
  /** 按 `process.platform-process.arch` 取文件，例如 `darwin-arm64`。 */
  assets: Readonly<Record<string, ToolAsset>>;
  /** 官方发布的下载地址：`{version}`、`{file}` 换成版本与文件名。 */
  officialUrl: string;
  /** 大小未知时给人看的估计。 */
  estimatedBytes: number;
  license: string;
  homepage: string;
}

export interface ToolManifest {
  name: string;
  label: string;
  purpose: Localized;
  /** 可执行文件的名字（在 PATH 里找它）。 */
  command: string;
  /** 探测参数：打印版本。 */
  versionArgs: readonly string[];
  /**
   * 从探测输出里取版本号。`known` 是探测的那一份已知的版本（受管副本是它的发布版本），没有时 null：不打印版本号的工具
   * （Real-ESRGAN）据此报告版本。
   */
  parseVersion(output: string, known: string | null): string | null;
  /** 除 0 以外也算探测成功的退出码：只能打印用法、打印完以非零退出的工具（Real-ESRGAN 的 `-h`）。 */
  probeExitCodes?: readonly number[];
  /** 低于它报告为「需要更新」；null 表示不检查。 */
  minVersion: string | null;
  /** 用之前要不要先得到用户同意（会联网下载第三方内容的工具要）。 */
  consentRequired: boolean;
  /** 能由 BaoCut 下载的工具的发布；null 表示只能由用户自己安装（ffmpeg）。 */
  release: ToolRelease | null;
  /** 环境变量指定的路径（ffmpeg 的 `BAOCUT_FFMPEG`）；优先于其余来源。 */
  envVar?: string;
  /** 用到它的任务种类：这些任务没结束时不删除受管副本（`TOOL_IN_USE`）。 */
  usedByJobKinds?: readonly string[];
  /** 用到它的流程：这些流程没结束时同样不删除受管副本。 */
  usedByPipelines?: readonly string[];
  /** 按原安装方式更新系统里的那一份（`externalTools.update`）；没有时不提供更新。 */
  update?: ToolUpdateRecipe;
  /** 缺失时的补救（按 Runtime 所在的平台给）。 */
  missingRemedy: Localized;
  /**
   * 找到的可执行文件能不能用（在执行 `--version` 之前判断）：不能用时给原因。PATH 里不能用的跳过、接着往后找；环境变量与用户指定的
   * 路径不能用时报告为不可用。macOS 上没装开发者工具时的 `/usr/bin/git` 是会弹出安装窗口的占位程序（`git-probe.ts`）。
   */
  usable?(file: string, platform: NodeJS.Platform): Promise<Localized | null>;
}

export const YT_DLP = 'yt-dlp';
export const FFMPEG = 'ffmpeg';
export const GIT = 'git';
export const REALESRGAN = 'realesrgan-ncnn-vulkan';

/**
 * yt-dlp 的发布：版本取自这台开发机上 Homebrew 安装的稳定版（Changelog 与 `yt_dlp/version.py` 都是 2026.07.04），没有对照
 * 上游核实；文件名按它随附的 README 里的发布文件表。大小与 sha256 都没有离线核实，留空（§14）。
 * Windows ARM64 的 `yt-dlp_arm64.exe` 按上游发布页从 2025.08.20 起才有（之前 ARM64 的 Windows 只能跑 x64 版）。
 * 许可：源码是 Unlicense；按上游 README，PyInstaller 打包的独立可执行文件含 GPLv3+ 代码，整体按 GPLv3+ 发布。
 */
const YT_DLP_RELEASE: ToolRelease = {
  version: '2026.07.04',
  assets: {
    'darwin-arm64': { fileName: 'yt-dlp_macos', size: null, sha256: null },
    'darwin-x64': { fileName: 'yt-dlp_macos', size: null, sha256: null },
    'linux-x64': { fileName: 'yt-dlp_linux', size: null, sha256: null },
    'linux-arm64': { fileName: 'yt-dlp_linux_aarch64', size: null, sha256: null },
    'win32-x64': { fileName: 'yt-dlp.exe', size: null, sha256: null },
    'win32-arm64': { fileName: 'yt-dlp_arm64.exe', size: null, sha256: null },
  },
  officialUrl: 'https://github.com/yt-dlp/yt-dlp/releases/download/{version}/{file}',
  estimatedBytes: 36 * 1024 * 1024,
  get license() {
    return RcExternalTools.ytDlpLicense().text;
  },
  homepage: 'https://github.com/yt-dlp/yt-dlp',
};

/**
 * Real-ESRGAN 的 ncnn 版（图片超分，架构设计 §7.9）：xinntao/Real-ESRGAN 发布页 v0.2.5.0 的便携包（20220424 构建），可执行文件
 * 与 `models/`（realesrgan-x4plus、realesrgan-x4plus-anime、realesr-animevideov3 的 x2/x3/x4）在同一个包里，只解开这两样；
 * Windows 包另带 OpenMP 运行库 `vcomp140.dll`。macOS 包是 x86_64 + arm64 的通用二进制，ncnn 经 MoltenVK 跑 Metal，两种 Mac
 * 共用一份。没有 ARM64 的 Windows 与 Linux 包。大小与 sha256 是 2026-10-27 按这个版本下载后在本机计算的（没有执行过里面的程序）。
 */
const REALESRGAN_DEMO_FILES = ['input.jpg', 'input2.jpg', 'onepiece_demo.mp4', 'vcomp140d.dll'];
const realesrganArchive = (readme: string): ToolAsset['archive'] => ({
  format: 'zip',
  skip: [...REALESRGAN_DEMO_FILES, readme],
  dirs: ['models'],
});
const REALESRGAN_MAC: ToolAsset = {
  fileName: 'realesrgan-ncnn-vulkan-20220424-macos.zip',
  size: 51817124,
  sha256: 'e0ad05580abfeb25f8d8fb55aaf7bedf552c375b5b4d9bd3c8d59764d2cc333a',
  archive: realesrganArchive('README_macos.md'),
};
const REALESRGAN_RELEASE: ToolRelease = {
  version: 'v0.2.5.0',
  assets: {
    'darwin-arm64': REALESRGAN_MAC,
    'darwin-x64': REALESRGAN_MAC,
    'linux-x64': {
      fileName: 'realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
      size: 46931474,
      sha256: 'e5aa6eb131234b87c0c51f82b89390f5e3e642b7b70f2b9bbe95b6a285a40c96',
      archive: realesrganArchive('README_ubuntu.md'),
    },
    'win32-x64': {
      fileName: 'realesrgan-ncnn-vulkan-20220424-windows.zip',
      size: 45474481,
      sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
      archive: realesrganArchive('README_windows.md'),
    },
  },
  officialUrl: 'https://github.com/xinntao/Real-ESRGAN/releases/download/{version}/{file}',
  estimatedBytes: 52 * 1024 * 1024,
  get license() {
    return RcExternalTools.realesrganLicense().text;
  },
  homepage: 'https://github.com/xinntao/Real-ESRGAN',
};

export const BUILTIN_TOOL_MANIFESTS: readonly ToolManifest[] = [
  {
    name: YT_DLP,
    label: 'yt-dlp',
    get purpose() {
      return RcExternalTools.ytDlpPurpose();
    },
    command: 'yt-dlp',
    versionArgs: ['--version'],
    parseVersion: (output) => /^\s*(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/.exec(output)?.[1] ?? null,
    // 按本机 Homebrew 安装附带的 Changelog：`--plugin-dirs` / `--no-plugin-dirs` 从 2024.10.22 起才有，流程要用它关掉插件目录。
    minVersion: '2024.10.22',
    consentRequired: true,
    release: YT_DLP_RELEASE,
    // 稳定版：`brew upgrade`、`pip install -U` 与 `yt-dlp -U` 都跟着各自的稳定通道；从源码装的 Homebrew 开发版照旧取最新提交。
    update: {
      formula: 'yt-dlp',
      pipxPackage: 'yt-dlp',
      pipRequirement: 'yt-dlp[default]',
      module: 'yt_dlp',
      selfUpdateArgs: ['-U'],
      wingetId: 'yt-dlp.yt-dlp',
      scoopApp: 'yt-dlp',
      chocolateyPackage: 'yt-dlp',
    },
    get missingRemedy() {
      return RcExternalTools.ytDlpMissingRemedy();
    },
  },
  {
    name: FFMPEG,
    label: 'ffmpeg',
    get purpose() {
      return RcExternalTools.ffmpegPurpose();
    },
    command: 'ffmpeg',
    versionArgs: ['-hide_banner', '-version'],
    parseVersion: (output) => /ffmpeg version (\S+)/.exec(output)?.[1] ?? null,
    minVersion: null,
    consentRequired: false,
    release: null,
    envVar: 'BAOCUT_FFMPEG',
    get missingRemedy() {
      return ffmpegMissingRemedyMessage();
    },
  },
  // git 桥（版本记录设计 §5、§7.2）：只检测、不下载，用户自己装的系统 git。2.30 起 `config --show-scope`、`--pathspec-from-file`
  // 与 `commit --only` 搭配 pathspec 文件都在。
  {
    name: GIT,
    label: 'git',
    get purpose() {
      return RcGit.gitPurpose();
    },
    command: 'git',
    versionArgs: ['--version'],
    // `git version 2.54.0 (Apple Git-157)`、`git version 2.45.1.windows.1`
    parseVersion: (output) => /git version (\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1] ?? null,
    minVersion: '2.30',
    consentRequired: false,
    release: null,
    envVar: 'BAOCUT_GIT',
    usable: macosGitUsable,
    get missingRemedy() {
      return gitMissingRemedy();
    },
  },
  // 图片超分（§7.9）：只在本机推理，不联网，用之前不另要同意（下载照常要同意）。
  {
    name: REALESRGAN,
    label: 'Real-ESRGAN',
    get purpose() {
      return RcExternalTools.realesrganPurpose();
    },
    command: REALESRGAN,
    // 没有打印版本的参数：`-h` 打印用法后以 -1 退出（POSIX 上是 255，Windows 上是 0xFFFFFFFF），用法里有程序名就算能运行。
    // 版本号不在输出里：受管副本报告它的发布版本，别处的报告 `unknown`。
    versionArgs: ['-h'],
    probeExitCodes: [255, -1, 4294967295],
    parseVersion: (output, known) => (/realesrgan-ncnn-vulkan/.test(output) ? (known ?? 'unknown') : null),
    minVersion: null,
    consentRequired: false,
    release: REALESRGAN_RELEASE,
    usedByPipelines: ['upscale-image'],
    get missingRemedy() {
      return RcExternalTools.realesrganMissingRemedy();
    },
  },
];

/** 缺 git 时的补救，按 Runtime 所在的平台。 */
export function gitMissingRemedy(platform: NodeJS.Platform = process.platform): Localized {
  if (platform === 'darwin') return RcGit.gitMissingRemedyMac();
  if (platform === 'win32') return RcGit.gitMissingRemedyWin();
  return RcGit.gitMissingRemedyLinux();
}

/** 这台机器的平台键。 */
export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

/**
 * 下载地址：给了镜像（设置 `tools.downloadEndpoint` 或环境变量 `BAOCUT_TOOLS_ENDPOINT`）时是 `<基址>/<工具>/<版本>/<文件名>`，
 * 否则是官方发布的地址。
 */
export function toolDownloadUrl(manifest: ToolManifest, release: ToolRelease, asset: ToolAsset, endpoint: string | null): string {
  if (endpoint) {
    const base = endpoint.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(manifest.name)}/${encodeURIComponent(release.version)}/${encodeURIComponent(asset.fileName)}`;
  }
  return release.officialUrl
    .replace('{version}', encodeURIComponent(release.version))
    .replace('{file}', encodeURIComponent(asset.fileName));
}

/** 下载之前告诉用户的事；不能下载时说明原因。 */
export function toolOffer(manifest: ToolManifest, endpoint: string | null, platform: string): ExternalToolOffer | null {
  const release = manifest.release;
  if (!release) return null;
  const asset = release.assets[platform] ?? null;
  const blockedReason = !asset ? RcExternalTools.noReleaseForPlatform({ platform }) : asset.sha256 === null ? RcExternalTools.noTrustedSha() : null;
  return {
    version: release.version,
    fileName: asset?.fileName ?? null,
    url: asset ? toolDownloadUrl(manifest, release, asset, endpoint) : null,
    sizeBytes: asset?.size ?? null,
    estimatedBytes: release.estimatedBytes,
    sha256: asset?.sha256 ?? null,
    license: release.license,
    homepage: release.homepage,
    blockedReason: blockedReason?.text ?? null,
    ...(blockedReason ? { blockedReasonRef: refOf(blockedReason) } : {}),
  };
}

/**
 * 比较两个点分的数字版本（yt-dlp 的 `2026.07.04`、夜间版的 `2026.07.04.123456`）：a < b 为负。不是数字的段按 0 处理。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
