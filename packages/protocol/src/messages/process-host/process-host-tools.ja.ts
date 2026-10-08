import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const ja: ProcessHostToolsMessages = {
  hintMac: '例：brew install ffmpeg',
  hintWindows: '例：winget install --id Gyan.FFmpeg -e を実行してから BaoCut を開き直す',
  hintLinux: '例：sudo apt install ffmpeg',
  hintDownload: (p) => `${p.url} からダウンロード`,
  remedyWithProbe: (p) =>
    `ffmpeg（ffprobe 同梱、${p.hint}）をインストールするか、環境変数 BAOCUT_FFMPEG / BAOCUT_FFPROBE で実行ファイルを指定してください`,
  remedy: (p) => `ffmpeg（${p.hint}）をインストールするか、BAOCUT_FFMPEG でパスを指定してください`,
  terminalBanner: (p) => `BaoCut：${p.command} を実行中`,
};
