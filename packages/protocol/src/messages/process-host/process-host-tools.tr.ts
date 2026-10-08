import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const tr: ProcessHostToolsMessages = {
hintMac: 'örneğin brew install ffmpeg', hintWindows: 'örneğin winget install --id Gyan.FFmpeg -e, sonra BaoCut yeniden açın', hintLinux: 'örneğin sudo apt install ffmpeg', hintDownload: (p) => `${p.url} kaynağından indirin`, remedyWithProbe: (p) => `ffmpeg yükleyin (ffprobe dahil; ${p.hint}) veya BAOCUT_FFMPEG / BAOCUT_FFPROBE ortam değişkenlerini çalıştırılabilir dosyalara yönlendirin`, remedy: (p) => `ffmpeg yükleyin (${p.hint}) veya BAOCUT_FFMPEG ile yolunu ayarlayın`, terminalBanner: (p) => `BaoCut: çalıştırılıyor ${p.command}`,
};
