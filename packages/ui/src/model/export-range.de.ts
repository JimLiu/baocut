import type { ExportRangeMessages } from './export-range.ts';

export const de: ExportRangeMessages = {
  modeAll: "Ganzes Video",
  modeChapters: "Nach Kapitel",
  modeClips: "Nach Clip",
  modeCustom: "Benutzerdefiniert",
  chapterN: (n: number) => `Kapitel ${n}`,
  clipN: (n: number) => `Clip ${n}`,
  whole: (clock: string) => `Ganzes Video ${clock}`,
  joined: (n: number, chapters: boolean, clock: string) =>
    `${n} ${chapters ? "Kapitel" : "Abschnitte"} zu einem verbunden · ${clock}`,
  separate: (n: number, clock: string) => `${n} Abschnitte · ${clock} insgesamt`,
};
