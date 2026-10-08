import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const ptBR: ComposerCompletionsMessages = {
  chapterN: (n: number) => `Capítulo ${n}`,
  chapterRange: (range: string) => `Capítulo · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ""} (${range})`,
  speaker: "Falante",
  speakerInsert: (name: string) => `@Falante “${name}”`,
};
