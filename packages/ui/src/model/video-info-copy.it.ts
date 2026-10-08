import type { VideoInfoMessages } from './video-info-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const it: VideoInfoMessages = {
  section: { media: 'Origine e media', source: 'Informazioni sull’origine' },
  speakers: (count: number) => pluralForm('it', count, { one: `${count} parlante`, other: `${count} parlanti` }),
  chapters: (count: number) => pluralForm('it', count, { one: `${count} capitolo`, other: `${count} capitoli` }),
  paragraphs: (count: number) => pluralForm('it', count, { one: `${count} paragrafo`, other: `${count} paragrafi` }),
  list: (names: readonly string[]) => names.join(', '),
  sourceKind: { 'link-import': 'Importato da URL', 'user-import': 'File locale', generated: 'Generato', library: 'Libreria utente' },
  row: { contents: 'Contenuti', translation: 'Traduzione', location: 'Posizione', file: 'File', media: 'Media', transcript: 'Trascrizione', channel: 'Canale', published: 'Pubblicato', platform: 'Piattaforma', mediaId: 'ID video', url: 'URL', title: 'Titolo originale', description: 'Descrizione' },
};
