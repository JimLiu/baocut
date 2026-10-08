import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const it: ComposerCompletionsMessages = {
  chapterN: (n: number) => `Capitolo ${n}`,
  chapterRange: (range: string) => `Capitolo · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ""} (${range})`,
  speaker: "Parlante",
  speakerInsert: (name: string) => `@Parlante «${name}»`,
};
