import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const zhHans: ProcessHostToolsMessages = {
  hintMac: '例如 brew install ffmpeg',
  hintWindows: '例如 winget install --id Gyan.FFmpeg -e，装好后重新打开 BaoCut',
  hintLinux: '例如 sudo apt install ffmpeg',
  hintDownload: (p) => `下载见 ${p.url}`,
  remedyWithProbe: (p) => `安装 ffmpeg（含 ffprobe，${p.hint}），或用环境变量 BAOCUT_FFMPEG / BAOCUT_FFPROBE 指定可执行文件`,
  remedy: (p) => `安装 ffmpeg（${p.hint}），或用 BAOCUT_FFMPEG 指定路径`,
  terminalBanner: (p) => `BaoCut：运行 ${p.command}`,
};
