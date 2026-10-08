import { pluralForm } from '@baocut/protocol';
import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const fr: LegacyImportMessages = {
  title: 'Importer les projets d’une version antérieure ?',
  lead: (n) =>
    pluralForm('fr', n, {
      one: `Cet ordinateur contient ${n} projet d’une version antérieure de BaoCut. Importez-le pour continuer à le modifier dans cette version. Les fichiers d’origine restent à leur place, sans modification.`,
      other: `Cet ordinateur contient ${n} projets d’une version antérieure de BaoCut. Importez-les pour continuer à les modifier dans cette version. Les fichiers d’origine restent à leur place, sans modification.`,
    }),
  found: 'Projets trouvés',
  destination: 'Importer dans',
  resetDefault: 'Utiliser l’emplacement par défaut',
  change: 'Changer…',
  pickTitle: 'Choisir où importer',
  destinationNote: 'Ce dossier apparaît comme un projet dans Home, et chaque ancien projet y devient une vidéo.',
  hint: 'Si vous ignorez, la question sera reposée au prochain démarrage de BaoCut. Cochez « Ne plus me le rappeler » pour ne jamais les importer.',
  never: 'Ne plus me le rappeler',
  skip: 'Ignorer',
  import: 'Importer',
  importing: (n) =>
    pluralForm('fr', n, {
      one: `Importation de ${n} ancien projet en arrière-plan`,
      other: `Importation de ${n} anciens projets en arrière-plan`,
    }),
  neverDone: 'L’importation des anciens projets ne vous sera plus rappelée. Les fichiers d’origine restent tels quels.',
  skipped: 'Ignoré. La question sera reposée au prochain démarrage de BaoCut.',
  failed: (message) => `Impossible d’importer : ${message}`,
};
