import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const pl: ComposerCompletionsMessages = {
  chapterN: (n: number) => `Rozdział ${n}`,
  chapterRange: (range: string) => `Rozdział · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ""} (${range})`,
  speaker: "Mówca",
  speakerInsert: (name: string) => `@Mówca „${name}”`,
};
