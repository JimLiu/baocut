import type { ProcessHostToolsMessages } from './process-host-tools.ts';

export const vi: ProcessHostToolsMessages = {
hintMac: 'ví dụ brew install ffmpeg', hintWindows: 'ví dụ winget install --id Gyan.FFmpeg -e rồi mở lại BaoCut', hintLinux: 'ví dụ sudo apt install ffmpeg', hintDownload: (p) => `tải từ ${p.url}`, remedyWithProbe: (p) => `Cài ffmpeg (kèm ffprobe; ${p.hint}) hoặc trỏ biến môi trường BAOCUT_FFMPEG / BAOCUT_FFPROBE đến tệp chạy`, remedy: (p) => `Cài ffmpeg (${p.hint}) hoặc đặt đường dẫn bằng BAOCUT_FFMPEG`, terminalBanner: (p) => `BaoCut: đang chạy ${p.command}`,
};
