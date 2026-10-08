import type { ProcessHostToolsMessages } from './process-host-tools.ts';
export const es: ProcessHostToolsMessages = {
 hintMac: 'por ejemplo, brew install ffmpeg', hintWindows: 'por ejemplo, winget install --id Gyan.FFmpeg -e y después vuelve a abrir BaoCut', hintLinux: 'por ejemplo, sudo apt install ffmpeg', hintDownload: (p) => `descárgalo de ${p.url}`,
 remedyWithProbe: (p) => `Instala ffmpeg (incluye ffprobe; ${p.hint}) o apunta las variables de entorno BAOCUT_FFMPEG / BAOCUT_FFPROBE a los ejecutables`, remedy: (p) => `Instala ffmpeg (${p.hint}) o establece su ruta con BAOCUT_FFMPEG`, terminalBanner: (p) => `BaoCut: ejecutando ${p.command}`,
};
