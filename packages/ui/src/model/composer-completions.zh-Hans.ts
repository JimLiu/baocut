import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const zhHans: ComposerCompletionsMessages = {
  chapterN: (n: number) => `第 ${n} 章`,
  chapterRange: (range: string) => `章节 · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''}（${range}）`,
  speaker: '说话人',
  speakerInsert: (name: string) => `@说话人「${name}」`,
};
