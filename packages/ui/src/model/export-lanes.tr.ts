import type { ExportLanesMessages } from './export-lanes.ts';

export const tr: ExportLanesMessages = {
hidden: 'Zaman çizelgesinde gizli', otherSolo: 'Başka iz tek başına çalıyor', muted: 'Zaman çizelgesinde sessiz', otherSoloAudio: 'Başka iz tek başına çalıyor', subtitles: 'Altyazı', names: (names) => names.join(', '), sound: (reason) => `Ses: ${reason}`, clips: (n) => `${n} klip`, sounds: (n) => `${n} ses klipi`,
};
