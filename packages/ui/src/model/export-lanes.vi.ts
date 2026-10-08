import type { ExportLanesMessages } from './export-lanes.ts';

export const vi: ExportLanesMessages = {
hidden: 'Ẩn trên dòng thời gian', otherSolo: 'Rãnh khác đang phát riêng', muted: 'Tắt tiếng trên dòng thời gian', otherSoloAudio: 'Rãnh khác đang phát riêng', subtitles: 'Phụ đề', names: (names) => names.join(', '), sound: (reason) => `Âm thanh: ${reason}`, clips: (n) => `${n} clip`, sounds: (n) => `${n} clip âm thanh`,
};
