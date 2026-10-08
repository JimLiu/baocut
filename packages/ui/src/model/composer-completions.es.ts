import type { ComposerCompletionsMessages } from './composer-completions.ts';
export const es: ComposerCompletionsMessages = {
 chapterN: (n: number) => `Capítulo ${n}`, chapterRange: (range: string) => `Capítulo · ${range}`,
 chapterInsert: (ordinal: string, name: string | null, range: string) => `@${ordinal}${name ? ` ${name}` : ''} (${range})`,
 speaker: 'Hablante', speakerInsert: (name: string) => `@Hablante «${name}»`,
};
