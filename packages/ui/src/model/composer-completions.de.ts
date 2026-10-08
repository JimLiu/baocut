import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const de: ComposerCompletionsMessages = {
  chapterN: (n: number) => `Kapitel ${n}`,
  chapterRange: (range: string) => `Kapitel · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ""} (${range})`,
  speaker: "Sprecher",
  speakerInsert: (name: string) => `@Sprecher „${name}“`,
};
