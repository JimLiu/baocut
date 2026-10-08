import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const ptBR: ProcessHostToolsMessages = {
  hintMac: "por exemplo, brew install ffmpeg",
  hintWindows: "por exemplo, winget install --id Gyan.FFmpeg -e, depois reabra o BaoCut",
  hintLinux: "por exemplo, sudo apt install ffmpeg",
  hintDownload: (p) => `baixe em ${p.url}`,
  remedyWithProbe: (p) => `Instale ffmpeg (inclui ffprobe; ${p.hint}), ou aponte as variáveis de ambiente BAOCUT_FFMPEG / BAOCUT_FFPROBE para os executáveis`,
  remedy: (p) => `Instale ffmpeg (${p.hint}), ou defina o caminho com BAOCUT_FFMPEG`,
  terminalBanner: (p) => `BaoCut: executando ${p.command}`,
};
