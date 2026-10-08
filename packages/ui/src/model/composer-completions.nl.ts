import type { ComposerCompletionsMessages } from './composer-completions.ts';
export const nl: ComposerCompletionsMessages = { chapterN: (n) => `Hoofdstuk ${n}`, chapterRange: (range) => `Hoofdstuk · ${range}`, chapterInsert: (ordinal, name, range) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`, speaker: 'Spreker', speakerInsert: (name) => `@Spreker ‘${name}’` };
