import { pluralForm } from '@baocut/protocol';
import type { LegacyImportRunMessages } from './legacy-import-run.ts';

const imported = (n: number) => pluralForm('fr', n, { one: `${n} importé`, other: `${n} importés` });
const notImported = (n: number) => pluralForm('fr', n, { one: `${n} non importé`, other: `${n} non importés` });
const stillNotImported = (n: number) =>
  pluralForm('fr', n, { one: `${n} toujours non importé`, other: `${n} toujours non importés` });

export const fr: LegacyImportRunMessages = {
  offlineTitle: (name) => `Le disque « ${name} » n’est pas connecté`,
  offlineWhy: (n, root) =>
    pluralForm('fr', n, {
      one: `Les vidéos utilisées par ce projet se trouvent sur ce disque (${root}), inaccessible pour le moment.`,
      other: `Les vidéos utilisées par ces ${n} projets se trouvent sur ce disque (${root}), inaccessible pour le moment.`,
    }),
  offlineFix:
    'Connectez le disque, puis cliquez sur « Réessayer ». Si vous ne faites rien, BaoCut réessaiera au prochain démarrage. Si vous n’avez plus besoin des médias, cliquez sur « Ignorer » : l’importation n’aura pas lieu.',
  offlineShort: (n, name) =>
    pluralForm('fr', n, {
      one: `${n} projet a ses médias sur « ${name} », qui n’est pas connecté`,
      other: `${n} projets ont leurs médias sur « ${name} », qui n’est pas connecté`,
    }),
  missingTitle: 'Les fichiers médias ne sont plus à leur place',
  missingWhy:
    'Des fichiers utilisés par le projet ont été déplacés, renommés ou supprimés : les chemins enregistrés dans l’ancien projet ne les trouvent plus.',
  missingFix:
    'Remettez les fichiers à leur place, puis cliquez sur « Réessayer ». Si vous ne pouvez pas les récupérer, cliquez sur « Ignorer ».',
  missingShort: (n) =>
    pluralForm('fr', n, {
      one: `${n} projet a des fichiers médias introuvables`,
      other: `${n} projets ont des fichiers médias introuvables`,
    }),
  unreadableTitle: 'Impossible de lire le fichier de l’ancien projet',
  unreadableWhy: 'Le fichier de l’ancien projet est peut-être endommagé : réessayer ne servira probablement à rien.',
  unreadableFix:
    'Affichez-le dans le dossier pour vérifier que l’original est toujours là et s’ouvre dans l’ancienne version. Si vous n’en avez pas besoin, cliquez sur « Ignorer ».',
  unreadableShort: (n) =>
    pluralForm('fr', n, {
      one: `${n} fichier de projet est illisible`,
      other: `${n} fichiers de projet sont illisibles`,
    }),
  failedTitle: 'L’importation s’est arrêtée en cours de route',
  failedWhy:
    'Le projet a été lu, mais son importation s’est arrêtée en cours de route. Le rapport d’importation indique ce qui s’est passé.',
  failedFix:
    'Cliquez sur « Réessayer » pour recommencer. Si l’échec persiste, affichez le rapport dans le dossier. Si vous n’avez pas besoin du projet, cliquez sur « Ignorer ».',
  failedShort: (n) =>
    pluralForm('fr', n, {
      one: `${n} projet s’est arrêté en cours d’importation`,
      other: `${n} projets se sont arrêtés en cours d’importation`,
    }),
  missingMany: (n, first) => `${n} fichiers manquants, par exemple ${first}`,
  missingOne: (file) => `Fichier manquant : ${file}`,
  missingNone: 'Fichiers médias introuvables',
  failedReport: (report) => `Rapport d’importation : ${report}`,
  failedNoReport: 'Aucun rapport d’importation n’a été écrit',
  note: (parts) => `${parts.join(' ; ')}.`,
  hintOffline: (name) =>
    `Connectez « ${name} », puis cliquez sur « Tout réessayer ». Si vous ne faites rien, BaoCut réessaiera au prochain démarrage. Pour les traiter un par un, ouvrez les détails.`,
  hintOther: 'Le motif et la marche à suivre pour chacun se trouvent dans les détails. Vous pouvez ignorer ceux dont vous n’avez pas besoin.',
  subProgress: (done, total) => `Importés ${done}/${total}`,
  subImported: (n) => `Importés ${n}`,
  subPending: (n) => `À traiter ${n}`,
  subSkipped: (n) => `Ignorés ${n}`,
  subDest: (dest) => `Vers ${dest}`,
  attention: (n) => `${n} à traiter`,
  phaseImporting: 'Importation',
  phaseWaiting: 'En attente d’autres tâches',
  detailImporting: (title) => `Importation de « ${title} »`,
  detailWaiting:
    'D’autres tâches sont en cours, l’importation est donc en pause. Elle reprendra automatiquement quand elles seront terminées.',
  bannerRunning: (done, total) => `Importation des anciens projets · ${done}/${total}`,
  bannerResult: (done, pending) => `Importation des anciens projets terminée : ${imported(done)}, ${notImported(pending)}`,
  doneAll: (n) => pluralForm('fr', n, { one: `${n} ancien projet importé`, other: `${n} anciens projets importés` }),
  doneSome: (done, pending) => `Importation terminée : ${imported(done)}, ${notImported(pending)}`,
  retriedAll: (n) =>
    pluralForm('fr', n, {
      one: 'Le projet réessayé a été importé',
      other: `Les ${n} projets réessayés ont tous été importés`,
    }),
  retriedSome: (n, ok) => `Sur les ${n} projets réessayés : ${imported(ok)}, ${stillNotImported(n - ok)}`,
  retriedNone: (n) =>
    pluralForm('fr', n, {
      one: 'Le projet réessayé n’a toujours pas été importé',
      other: `Les ${n} projets réessayés n’ont toujours pas été importés`,
    }),
  retrying: (n) => pluralForm('fr', n, { one: `Nouvelle importation de ${n} projet`, other: `Nouvelle importation de ${n} projets` }),
  skipped: (n) =>
    pluralForm('fr', n, {
      one: `${n} projet ignoré. Il ne sera pas importé automatiquement.`,
      other: `${n} projets ignorés. Ils ne seront pas importés automatiquement.`,
    }),
  actionFailed: (message) => `Action impossible : ${message}`,
  undo: 'Annuler',
  viewReasons: 'Voir pourquoi',
  viewInSpace: 'Voir dans Space',
  viewProgress: 'Voir la progression',
  close: 'Fermer',
  retryAll: 'Tout réessayer',
  skipAll: 'Tout ignorer',
  retry: 'Réessayer',
  skip: 'Ignorer',
  reveal: 'Afficher dans le dossier',
  importInstead: 'Importer',
  statImported: 'Importés',
  statPending: 'Non importés',
  statSkipped: 'Ignorés',
  statLive: 'Pas encore importés',
  pendingSection: 'Projets non importés',
  pendingHint: 'Si vous ne faites rien, BaoCut réessaiera au prochain démarrage. Les projets ignorés ne sont pas importés.',
  howTo: 'Que faire : ',
  groupTitle: (title, n) => `${title} · ${n}`,
  liveSection: 'En cours d’importation',
  importingChip: 'Importation',
  queuedChip: 'En file',
  importedSection: 'Importés',
  skippedSection: 'Ignorés',
  skippedHint: 'Ils ne seront pas importés automatiquement. Les fichiers d’origine restent à leur place.',
  expand: (n) => `Afficher ${n} de plus`,
  collapse: 'Afficher moins',
};
