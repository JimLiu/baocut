import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const nl: ProcessHostToolsMessages = {
  hintMac: "bijvoorbeeld brew install ffmpeg",
  hintWindows: "bijvoorbeeld winget install --id Gyan.FFmpeg -e en open BaoCut daarna opnieuw",
  hintLinux: "bijvoorbeeld sudo apt install ffmpeg",
  hintDownload: (p: { url: string }) => `download het van ${p.url}`,
  remedyWithProbe: (p: { hint: string }) =>
    `Installeer ffmpeg (inclusief ffprobe; ${p.hint}) of laat de omgevingsvariabelen BAOCUT_FFMPEG / BAOCUT_FFPROBE naar de uitvoerbare bestanden verwijzen`,
  remedy: (p: { hint: string }) => `Installeer ffmpeg (${p.hint}) of stel het pad in met BAOCUT_FFMPEG`,
  terminalBanner: (p: { command: string }) => `BaoCut: uitvoeren van ${p.command}`,
};
