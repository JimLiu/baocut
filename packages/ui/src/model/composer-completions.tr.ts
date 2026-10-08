import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const tr: ComposerCompletionsMessages = {
chapterN: (n) => `Bölüm ${n}`, chapterRange: (range) => `Bölüm · ${range}`, chapterInsert: (ordinal, name, range) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`, speaker: 'Konuşmacı', speakerInsert: (name) => `@Konuşmacı “${name}”`,
};
