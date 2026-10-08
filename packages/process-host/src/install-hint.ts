/**
 * 找不到 ffmpeg 时给用户的那句修法，按 Runtime 所在的平台给（缺工具的是 Runtime 这台机器，不是看界面的那台）。
 *
 * 命令与设计稿 `model-video.js` 的 `installCommand` / `manualInstall` 一致：macOS 用 Homebrew，Windows 用 winget，
 * 都给不出命令的平台给官网下载页。Linux 的发行版各有各的包管理器，举 Debian / Ubuntu 的 apt 为例。
 *
 * Windows 上装好之后要重新打开 BaoCut：PATH 在进程启动时就定了，winget 改的是新进程才读得到的那一份。
 */

import type { Localized } from '@baocut/protocol';
import { ProcessHostTools as T } from '@baocut/protocol/messages/process-host';

export const FFMPEG_DOWNLOAD_URL = 'https://ffmpeg.org/download.html';

/** 这个平台上安装 ffmpeg 的一句提示（不含「安装 ffmpeg」本身），例如「例如 brew install ffmpeg」。 */
export function ffmpegInstallHint(platform: string = process.platform): string {
  return installHintMessage(platform).text;
}

function installHintMessage(platform: string): Localized {
  switch (platform) {
    case 'darwin':
      return T.hintMac();
    case 'win32':
      return T.hintWindows();
    case 'linux':
      return T.hintLinux();
    default:
      return T.hintDownload({ url: FFMPEG_DOWNLOAD_URL });
  }
}

/**
 * 找不到 ffmpeg 时的完整修法。`ffprobe` 为 true 时连 ffprobe 一起说（导出、确认媒体要用它；它随 ffmpeg 一起装）。
 */
export function ffmpegMissingRemedy(options: { ffprobe?: boolean; platform?: string } = {}): string {
  return ffmpegMissingRemedyMessage(options).text;
}

/** 同 `ffmpegMissingRemedy`，带消息引用：嵌进别的 `Localized` 的参数里时，读者那边能按自己的语言重新显示。 */
export function ffmpegMissingRemedyMessage(options: { ffprobe?: boolean; platform?: string } = {}): Localized {
  const hint = installHintMessage(options.platform ?? process.platform);
  return options.ffprobe ? T.remedyWithProbe({ hint }) : T.remedy({ hint });
}
