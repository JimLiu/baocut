import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const ru: ProcessHostToolsMessages = {
  hintMac: "например, brew install ffmpeg",
  hintWindows: "например, winget install --id Gyan.FFmpeg -e, затем снова откройте BaoCut",
  hintLinux: "например, sudo apt install ffmpeg",
  hintDownload: (p) => `скачайте с ${p.url}`,
  remedyWithProbe: (p) => `Установите ffmpeg (включает ffprobe; ${p.hint}) или укажите исполняемые файлы в переменных окружения BAOCUT_FFMPEG / BAOCUT_FFPROBE`,
  remedy: (p) => `Установите ffmpeg (${p.hint}) или задайте путь к нему через BAOCUT_FFMPEG`,
  terminalBanner: (p) => `BaoCut: выполнение ${p.command}`,
};
