import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const de: ProcessHostToolsMessages = {
  hintMac: "zum Beispiel brew install ffmpeg",
  hintWindows: "zum Beispiel winget install --id Gyan.FFmpeg -e; danach BaoCut erneut öffnen",
  hintLinux: "zum Beispiel sudo apt install ffmpeg",
  hintDownload: (p: { url: string }) => `herunterladen von ${p.url}`,
  remedyWithProbe: (p: { hint: string }) =>
    `ffmpeg installieren (enthält ffprobe; ${p.hint}) oder BAOCUT_FFMPEG / BAOCUT_FFPROBE auf die ausführbaren Dateien verweisen lassen`,
  remedy: (p: { hint: string }) => `ffmpeg installieren (${p.hint}) oder seinen Pfad mit BAOCUT_FFMPEG festlegen`,
  terminalBanner: (p: { command: string }) => `BaoCut: Ausführen von ${p.command}`,
};
