import { pluralForm } from '@baocut/protocol';
import type { ExportLanesMessages } from './export-lanes.ts';

export const ru: ExportLanesMessages = {
  hidden: "Скрыто на таймлайне",
  otherSolo: "Другая дорожка воспроизводится соло",
  muted: "Звук отключён на таймлайне",
  otherSoloAudio: "Другая дорожка воспроизводится соло",
  subtitles: "Субтитры",
  names: (names: readonly string[]) => names.join(", "),
  sound: (reason: string) => `Звук: ${reason}`,
  clips: (n: number) => pluralForm('ru', n, { one: `${n} клип`, few: `${n} клипа`, many: `${n} клипов`, other: `${n} клипа` }),
  sounds: (n: number) => pluralForm('ru', n, { one: `${n} аудиоклип`, few: `${n} аудиоклипа`, many: `${n} аудиоклипов`, other: `${n} аудиоклипа` }),
};
