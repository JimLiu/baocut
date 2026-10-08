import { ffmpegMissingRemedyMessage } from '@baocut/process-host';
import { refOf, type ExternalToolOffer, type Localized } from '@baocut/protocol';
import type { ToolUpdateRecipe } from './tool-update-plan.ts';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

/**
 * 受管外部工具的登记表（架构设计 §12.9）。每个工具一份清单：用途、最低版本、探测方式，能由 BaoCut 下载的再带固定的发布版本、
 * 各平台的文件、大小、sha256 与许可。
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
  /** 从探测输出里取版本号。 */
  parseVersion(output: string): string | null;
  /** 低于它报告为「需要更新」；null 表示不检查。 */
  minVersion: string | null;
  /** 用之前要不要先得到用户同意（会联网下载第三方内容的工具要）。 */
  consentRequired: boolean;
  /** 能由 BaoCut 下载的工具的发布；null 表示只能由用户自己安装（ffmpeg）。 */
  release: ToolRelease | null;
  /** 环境变量指定的路径（ffmpeg 的 `BAOCUT_FFMPEG`）；优先于其余来源。 */
  envVar?: string;
  /** 按原安装方式更新系统里的那一份（`externalTools.update`）；没有时不提供更新。 */
  update?: ToolUpdateRecipe;
  /** 缺失时的补救（按 Runtime 所在的平台给）。 */
  missingRemedy: Localized;
}

export const YT_DLP = 'yt-dlp';
export const FFMPEG = 'ffmpeg';

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
];

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
