import type { ComposerCompletionsMessages } from './composer-completions.ts';

export const fr: ComposerCompletionsMessages = {
  chapterN: (n) => `Chapitre ${n}`, chapterRange: (range) => `Chapitre · ${range}`, chapterInsert: (ordinal, name, range) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`, speaker: 'Locuteur', speakerInsert: (name) => `@Locuteur « ${name} »`,
};
