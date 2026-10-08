import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const pl: ProcessHostToolsMessages = {
  hintMac: "na przykład brew install ffmpeg",
  hintWindows: "na przykład winget install --id Gyan.FFmpeg -e, a następnie otwórz BaoCut ponownie",
  hintLinux: "na przykład sudo apt install ffmpeg",
  hintDownload: (p) => `pobierz z ${p.url}`,
  remedyWithProbe: (p) => `Zainstaluj ffmpeg (zawiera ffprobe; ${p.hint}) lub wskaż pliki wykonywalne w zmiennych środowiskowych BAOCUT_FFMPEG / BAOCUT_FFPROBE`,
  remedy: (p) => `Zainstaluj ffmpeg (${p.hint}) lub ustaw jego ścieżkę przez BAOCUT_FFMPEG`,
  terminalBanner: (p) => `BaoCut: uruchamianie ${p.command}`,
};
