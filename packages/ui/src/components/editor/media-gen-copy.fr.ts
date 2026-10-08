import { pluralForm } from '@baocut/protocol';
import type { AudioGenMessages, GeneratedMarkMessages, ImageGenMessages } from './media-gen-copy.ts';

export const frMark: GeneratedMarkMessages = { generated: "Généré" };

export const frAudioGen: AudioGenMessages = {
  generate: "Générer la voix",
  clone: "Cloner la voix",
  generateTip: "Lire du texte avec un modèle cloud et l’ajouter à la bibliothèque de médias",
  cloneTip: "Lire du texte avec une voix clonée dans Mes voix",
  back: "Retour à Audio",
  running: "En cours en arrière-plan",
  textPlaceholder: "Texte à synthétiser ; séparer les segments par des points ou sauts de ligne…",
  clonePlaceholder: "Ce que cette voix doit dire…",
  cta: "Générer",
  cloneCta: "Générer avec cette voix",
  hint: (provider: string) =>
    `Envoyé en ligne à ${provider} pour synthèse, facturé selon ses règles. Progression dans la barre supérieure et Tâches en arrière-plan ; résultat ajouté aux médias, placement sur la timeline séparé. Arrêter l’attente ne rappelle pas une requête déjà envoyée.`,
  readOnly: "Cette vidéo est actuellement en lecture seule ; aucun média ne peut y être généré",
  noVoicesTitle: "Aucune voix dans Mes voix",
  noVoicesBody:
    "Pour cloner une voix, enregistrez-la ou importez un fichier dans Modèles › Synthèse vocale › Mes voix, puis envoyez-la à un fournisseur de clonage (ElevenLabs). Revenez la choisir ci-dessous.",
  goVoices: "Ouvrir Mes voix",
  runTitle: (title: string) => `${title}…`,
  runNote: "Vous pouvez continuer le montage · synthèse en arrière-plan, résultat ajouté aux médias à la fin.",
  cancel: "Annuler",
  cancelled: "Annulé",
  done: (meta: string) => `Généré · ${meta}`,
  inLibrary: (name: string) => `Ajouté aux médias · ${name}`,
  importing: "Ajout aux médias…",
  add: "Ajouter à la timeline",
  addTip: "Placer à la tête de lecture",
  again: "En générer une autre",
  backToAudio: "Retour à Audio",
  doneNote: "Le média est dans la bibliothèque Audio, marqué « Généré ». Glissez-le sur la timeline ou cliquez « + » ; réutilisable autant que voulu.",
  failed: (message: string) => `Impossible de générer · ${message}`,
  edit: "Modifier et générer à nouveau",
  retried: "Soumis à nouveau",
};

export const frImageGen: ImageGenMessages = {
  title: "Images",
  segments: "Source d’image",
  project: "Médias vidéo",
  gen: "Générée par IA",
  noModelTitle: "Aucun modèle d’image",
  noModelBody:
    "Connectez un fournisseur cloud (Modèles › Génération d’images › Modèles cloud) ou téléchargez Qwen-Image-2.1 (Modèles › Génération d’images › Modèles locaux) ; les deux conviennent.",
  connect: "Connecter un fournisseur cloud",
  downloadLocal: "Télécharger un modèle local",
  fit: "Comme le canevas vidéo",
  recent: "Récent",
  all: (n: number) => `Tous les ${n} ${pluralForm('fr', n, { one: "lot", other: "lots" })}`,
  fewer: "Seulement les 3 derniers lots",
  empty: "Aucune image générée pour cette vidéo. Les images vont directement dans les médias (« Généré ») ; leur placement sur le canevas est séparé.",
  place: "Placer sur le canevas",
  placeTip: "Placer à la tête de lecture",
  inLibrary: "Dans la bibliothèque de médias",
  importing: "Ajout aux médias…",
  useAsRef: "Utiliser comme référence",
  foot: "Les images générées vont directement dans les médias de cette vidéo avec leur origine (modèle, paramètres, tâche) ; le prompt reste seulement dans l’enregistrement de tâche. Placement sur le canevas séparé.",
  readOnly: "Cette vidéo est actuellement en lecture seule ; aucun média ne peut y être généré",
  charCount: (chars: number, max: number) => `${chars} / ${max} caractères`,
  charCountPlain: (chars: number) => `${chars} ${pluralForm('fr', chars, { one: "caractère", other: "caractères" })}`,
};
