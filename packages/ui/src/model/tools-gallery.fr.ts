import type { ToolsGalleryMessages } from './tools-gallery.ts';
import { pluralForm } from '@baocut/protocol';

export const fr: ToolsGalleryMessages = {
  transcode: 'Encodage sur cet ordinateur avec ffmpeg · aucun envoi', linkReady: 'Outil de téléchargement prêt',
  pipelineMissing: 'Cette version du Runtime n’a pas encore de processus pour cet outil ; il est donc indisponible pour le moment',
  withRemedy: (message, remedy) => `${message}. ${remedy}`,
  localModels: (n) => `${n} ${pluralForm('fr', n, { one: 'modèle local', other: 'modèles locaux' })}`,
  cloudConnected: (n) => `${n} ${pluralForm('fr', n, { one: 'fournisseur en ligne connecté', other: 'fournisseurs en ligne connectés' })}`,
  noSpeech: 'Aucun modèle de synthèse vocale disponible', noImage: 'Aucun modèle de génération d’images disponible', noText: 'Aucun modèle de texte disponible',
};
