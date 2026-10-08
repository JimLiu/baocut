import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const it: ProcessHostToolsMessages = {
  hintMac: "ad esempio, brew install ffmpeg",
  hintWindows: "ad esempio, winget install --id Gyan.FFmpeg -e, poi riapri BaoCut",
  hintLinux: "ad esempio, sudo apt install ffmpeg",
  hintDownload: (p) => `scaricalo da ${p.url}`,
  remedyWithProbe: (p) => `Installa ffmpeg (include ffprobe; ${p.hint}), oppure indica gli eseguibili con le variabili d’ambiente BAOCUT_FFMPEG / BAOCUT_FFPROBE`,
  remedy: (p) => `Installa ffmpeg (${p.hint}), oppure imposta il percorso con BAOCUT_FFMPEG`,
  terminalBanner: (p) => `BaoCut: esecuzione di ${p.command}`,
};
