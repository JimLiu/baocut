import type { VideoInfoMessages } from './video-info-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: VideoInfoMessages = {
  section: { media: 'Source et médias', source: 'Informations sur la source' },
  speakers: (count) => `${count} ${pluralForm('fr', count, { one: 'locuteur', other: 'locuteurs' })}`,
  chapters: (count) => `${count} ${pluralForm('fr', count, { one: 'chapitre', other: 'chapitres' })}`,
  paragraphs: (count) => `${count} ${pluralForm('fr', count, { one: 'paragraphe', other: 'paragraphes' })}`, list: (names) => names.join(', '),
  sourceKind: { 'link-import': 'Importé depuis une URL', 'user-import': 'Fichier local', generated: 'Généré', library: 'Bibliothèque utilisateur' },
  row: { contents: 'Contenu', translation: 'Traduction', location: 'Emplacement', file: 'Fichier', media: 'Médias', transcript: 'Transcription', channel: 'Chaîne', published: 'Publication', platform: 'Plateforme', mediaId: 'ID vidéo', url: 'URL', title: 'Titre d’origine', description: 'Description' },
};
