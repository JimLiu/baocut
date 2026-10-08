import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const ja: ComposerCompletionsMessages = {
  chapterN: (n: number) => `チャプター ${n}`,
  chapterRange: (range: string) => `チャプター · ${range}`,
  chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''}（${range}）`,
  speaker: '話者',
  speakerInsert: (name: string) => `@話者「${name}」`,
};
