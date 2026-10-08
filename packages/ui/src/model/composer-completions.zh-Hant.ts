import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const zhHant: ComposerCompletionsMessages = {
  chapterN: (n: number) => `第 ${n} 章`,
  chapterRange: (range: string) => `章節 · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''}（${range}）`,
  speaker: '說話者',
  speakerInsert: (name: string) => `@說話者「${name}」`,
};
