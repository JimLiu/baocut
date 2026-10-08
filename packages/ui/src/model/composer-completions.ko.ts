import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const ko: ComposerCompletionsMessages = {
  chapterN: (n: number) => `챕터 ${n}`,
  chapterRange: (range: string) => `챕터 · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''}(${range})`,
  speaker: '화자',
  speakerInsert: (name: string) => `@화자 “${name}”`,
};
