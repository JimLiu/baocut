import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const fr: ProcessHostToolsMessages = {
  hintMac: 'par exemple, brew install ffmpeg', hintWindows: 'par exemple, winget install --id Gyan.FFmpeg -e, puis rouvrez BaoCut', hintLinux: 'par exemple, sudo apt install ffmpeg',
  hintDownload: (p) => `téléchargez-le depuis ${p.url}`, remedyWithProbe: (p) => `Installez ffmpeg (inclut ffprobe ; ${p.hint}), ou faites pointer les variables d’environnement BAOCUT_FFMPEG / BAOCUT_FFPROBE vers les exécutables`,
  remedy: (p) => `Installez ffmpeg (${p.hint}), ou définissez son chemin avec BAOCUT_FFMPEG`, terminalBanner: (p) => `BaoCut : exécution de ${p.command}`,
};
