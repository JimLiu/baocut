import type { ToolCatalogMessages } from './tool-catalog-copy.ts';
const artifactLabels = { audio: 'Audio', image: 'Image', doc: 'Document', final: 'Fichier vidéo', subtitle: 'Sous-titres' };

export const fr: ToolCatalogMessages = {
  inputLabels: { file: 'Fichier local', space: 'Space', link: 'Lien', text: 'Texte', video: 'Vidéo dans Space', document: 'Document' },
  outputLabels: { video: 'Vidéo', artifact: 'Élément dans Space' },
  artifactLabels,
  tools: {
    transcribe: { name: 'Transcrire', desc: 'Transformer un fichier vidéo ou audio en transcription et sous-titres ; pour une vidéo modifiable, les y enregistrer et ajouter un calque de sous-titres' },
    'translate-subtitles': { name: 'Traduire les sous-titres', desc: 'Traduire les sous-titres dans une autre langue ; pour une vidéo transcrite, ajouter une traduction et un calque de sous-titres pouvant afficher les deux langues, sans modifier l’original' },
    dub: { name: 'Doublage traduit', desc: 'Ajouter à une vidéo transcrite un nouveau doublage à partir de sa traduction ; l’audio original peut être atténué, coupé ou conservé' },
    'synthesize-speech': { name: 'Générer la voix', desc: 'Lire à voix haute du texte, ou des documents et sous-titres dans Space ; utiliser une voix prédéfinie, cloner un enregistrement ou décrire une voix' },
    'generate-text': { name: 'Générer du texte', desc: 'Décrire votre besoin et appeler directement un modèle de texte pour des textes, scripts ou résumés ; vous pouvez joindre des documents ou sous-titres dans Space comme sources' },
    'generate-image': { name: 'Générer une image', desc: 'Décrire une image et la dessiner avec un modèle d’image cloud ou local ; images de référence, format et nombre sont facultatifs' },
    'link-import': { name: 'Télécharger une vidéo', desc: 'Coller un lien pour télécharger une vidéo sur cet ordinateur ; les cookies du navigateur peuvent être utilisés, et le fichier téléchargé peut être transcrit en transcription et sous-titres' },
    'compress-video': { name: 'Compresser une vidéo', desc: 'Réencoder selon une taille ou une qualité cible ; réduire la taille avant l’envoi ou la mise en ligne' },
    'merge-video': { name: 'Fusionner des vidéos', desc: 'Assembler plusieurs vidéos bout à bout dans un seul fichier, dans l’ordre' },
    'extract-audio': { name: 'Extraire l’audio', desc: 'Supprimer l’image et conserver uniquement la piste audio ; les codecs audio courants sont copiés tels quels, sans réencodage' },
  },
  targetNone: 'Créer uniquement une transcription et des sous-titres', targetCreate: 'Créer une vidéo dans un projet', subtitleFile: 'Fichier de sous-titres local',
  groups: {
    speech: { label: 'Voix et sous-titres', desc: 'Transcrire, traduire les sous-titres, ajouter des doublages et lire du texte à voix haute. Les résultats sont des éléments document, sous-titres et audio ; choisir une vidéo modifiable dans Space les y enregistre.' },
    'text-image': { label: 'Texte et images', desc: 'Appeler directement des modèles de texte et d’image. Les résultats sont des éléments document et image.' },
    'video-file': { label: 'Fichiers vidéo', desc: 'Télécharger, compresser et fusionner des vidéos et extraire l’audio avec yt-dlp et ffmpeg sur cet ordinateur. Les résultats sont des éléments fichier vidéo et audio.' },
  },
  artifactItems: (artifacts) => artifacts.length ? `éléments ${artifacts.map((a) => artifactLabels[a].toLocaleLowerCase('fr')).join(' et ')}` : 'éléments de résultat',
  resultWritesVideo: 'Résultat : enregistré dans la vidéo choisie', resultInSpace: (items) => `Résultat : ${items} dans Space`,
  resultAlsoCreate: 'peut aussi créer une vidéo', resultWritesEditable: 'enregistre dans une vidéo modifiable si vous en choisissez une',
  joinResult: (parts) => parts.join(' ; '),
};
