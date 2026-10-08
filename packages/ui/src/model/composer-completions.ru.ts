import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const ru: ComposerCompletionsMessages = {
  chapterN: (n: number) => `Глава ${n}`,
  chapterRange: (range: string) => `Глава · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ""} (${range})`,
  speaker: "Говорящий",
  speakerInsert: (name: string) => `@Говорящий «${name}»`,
};
