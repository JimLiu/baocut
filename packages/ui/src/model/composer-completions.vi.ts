import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const vi: ComposerCompletionsMessages = {
chapterN: (n) => `Chương ${n}`, chapterRange: (range) => `Chương · ${range}`, chapterInsert: (ordinal, name, range) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`, speaker: 'Người nói', speakerInsert: (name) => `@Người nói “${name}”`,
};
