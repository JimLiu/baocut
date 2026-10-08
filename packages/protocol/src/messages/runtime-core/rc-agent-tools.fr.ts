import type { RcAgentToolsMessages } from './rc-agent-tools.ts';
import { pluralForm } from '../../i18n.ts';

function exportKindLabel(kind: string): string {
  switch (kind) { case 'subtitles': return 'les sous-titres'; case 'transcript': return 'la transcription'; case 'audio': return 'l’audio'; case 'video': return 'le fichier vidéo'; case 'portable': return 'le paquet portable'; case 'project': return 'le fichier de projet'; default: return kind; }
}
function linkImportAfter(p: { target: string; name: string | null; transcribe: boolean; language: string | null; provider: string | null; model: string | null; captions: boolean }): string {
  const recognition = `${p.language ? `, langue ${p.language}` : ''}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`;
  if (p.target === 'create') return `, créer une vidéo${p.name ? ` « ${p.name} »` : ' (nommée d’après le titre de la page)'} et l’ajouter à la timeline${p.transcribe ? `, puis la transcrire${recognition}${p.captions ? ' et créer un calque de sous-titres' : ''}` : ''}`;
  if (p.target === 'video') return `, l’importer dans la vidéo${p.transcribe ? ' et la transcrire' : ''}`;
  if (p.target === 'project') return `, l’enregistrer dans downloads/ du projet${p.transcribe ? ' et la transcrire en TXT et SRT' : ''}`;
  if (p.target === 'download') return `, l’enregistrer dans le dossier Téléchargements${p.transcribe ? ' et la transcrire en TXT et SRT' : ''}`;
  return '';
}

export const fr: RcAgentToolsMessages = {
  instructionsNotSet: 'Les instructions de session n’ont pas été définies : l’ordre d’assemblage du Runtime est incorrect', listSeparator: ', ', clauseSeparator: ' ; ',
  createVideoSummary: (p) => `Créer la vidéo « ${p.name} »`, editsSummary: (p) => `${p.label} (${p.count} ${pluralForm('fr', p.count, { one: 'opération', other: 'opérations' })} : ${p.types})`,
  captionsSummary: (p) => `Ajouter un calque de sous-titres ${p.bilingual ? 'bilingue ' : ''}pour le document ${p.documentId}`, captionsLabel: 'Ajouter un calque de sous-titres',
  undoSummary: (p) => `Annuler la modification ${p.transactionId}`, undoLatestSummary: 'Annuler la dernière modification',
  deleteVideoSummary: (p) => `Supprimer la vidéo « ${p.name} » (${p.path}) : la déplacer dans la corbeille, où elle peut être restaurée dans Space pendant ${p.days} ${pluralForm('fr', p.days, { one: 'jour', other: 'jours' })}. Les fichiers originaux des médias liés restent à leur emplacement`,
  importPackageSummary: (p) => `Ouvrir le paquet portable ${p.file}`, renameVideoLabel: 'Renommer la vidéo', putDocumentSummary: (p) => `Écrire une nouvelle version du document ${p.documentId}`,
  newDocumentSummary: (p) => `Créer un document (${p.kind})`, updateDocumentLabel: (p) => `Mettre à jour le document « ${p.name} »`, newDocumentLabel: (p) => `Créer le document « ${p.name} »`, translationDocumentName: (p) => `Traduction en ${p.language}`,
  importAssetSummary: (p) => `Importer le média ${p.name}${p.place ? ' et l’ajouter à la timeline' : ''}`, importAssetLabel: (p) => `Importer ${p.name}${p.place ? ' et l’ajouter à la timeline' : ''}`,
  replaceCompositionSummary: (p) => `Importer ${p.name} et remplacer le clip ${p.clip} de la timeline`,
  replaceCompositionLabel: (p) => `Remplacer le graphisme animé par ${p.name}`,
  pruneAssetsSummary: (p) => `Retirer de la vidéo les médias inutilisés (${p.count}) : ${p.names}`,
  pruneAssetsLabel: (p) => `Retirer les médias inutilisés (${p.count})`,
  adoptChaptersSummary: (p) =>
    `Reprendre les chapitres d’origine de ${p.asset} (${p.count})${p.existing ? `, en remplaçant les chapitres actuels (${p.existing})` : ''}`,
  adoptChaptersLabel: 'Reprendre les chapitres d’origine',
  transcribePurpose: (p) => `Transcrire le média ${p.assetId}`, transcribeSummary: (p) => `Transcrire le média ${p.assetId}${p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''}`,
  speechPurpose: (p) => `Synthétiser la voix (${p.chars} ${pluralForm('fr', p.chars, { one: 'caractère', other: 'caractères' })})`,
  speechSummary: (p) => `Synthétiser la voix (${p.chars} ${pluralForm('fr', p.chars, { one: 'caractère', other: 'caractères' })}${p.provider ? `, ${p.provider}` : ''}${p.voice ? `, voix ${p.voice}` : ''})`,
  imagePurpose: (p) => `Générer une image : ${p.prompt}`, imageSummary: (p) => `Générer ${p.count} ${pluralForm('fr', p.count, { one: 'image', other: 'images' })}${p.size ? `, ${p.size}` : ''}${p.provider ? `, ${p.provider}` : ''} : ${p.prompt}`,
  cancelJobSummary: (p) => `Annuler la tâche ${p.jobId}`, retryPipelineSummary: (p) => `Relancer le processus ${p.jobId} (${p.pipeline}, tentative ${p.attempt}) depuis l’étape en échec`,
  saveArtifactSummary: (p) => `Enregistrer le résultat ${p.artifactId} sous ${p.path}`, overwriteArtifactSummary: (p) => `Écraser le fichier existant ${p.path} avec le résultat ${p.artifactId}`,
  exportSummary: (p) => {
    const range = p.rangeStart !== null ? `, ${p.rangeStart}–${p.rangeEnd} s` : p.rangeCount !== null ? `, ${p.rangeCount} ${pluralForm('fr', p.rangeCount, { one: 'plage', other: 'plages' })}` : '';
    const size = p.width !== null && p.height !== null ? `, ${p.width}×${p.height}` : p.width !== null ? `, largeur ${p.width}` : p.height !== null ? `, hauteur ${p.height}` : '';
    const source = p.originalOnly ? ', audio original uniquement' : p.dubGroupId ? `, doublage ${p.dubGroupId} uniquement` : '';
    return `Exporter ${exportKindLabel(p.kind)} (${p.format}${range}${size}${source})${p.fileName ? ` sous ${p.fileName}` : ''}${p.overwrite ? ', en écrasant le fichier existant' : ''}`;
  },
  installToolSummary: (p) => `Installer ${p.tool} ${p.version} (${p.estimated ? `environ ${p.size}` : p.size}, ${p.license}) depuis ${p.url} pour télécharger des vidéos depuis des liens ; le téléchargement depuis ${p.host} en a besoin`,
  linkImportSummary: (p) => `Télécharger depuis ${p.host} avec ${p.tool}${p.version ? ` ${p.version}` : ''} : ${p.url}${linkImportAfter(p)}`,
  linkImportConsentSummary: (p) => `Autoriser BaoCut à utiliser ${p.tool}${p.version ? ` ${p.version}` : ''} sur cet ordinateur${p.path ? ` (${p.path})` : ''} pour télécharger des vidéos depuis des sites web, et télécharger depuis ${p.host} : ${p.url}${linkImportAfter(p)}`,
  downloadSaveSummary: (p) => `Copier ${p.source} (${p.size}) du dossier de travail vers le dossier Téléchargements : ${p.target} (numéroté si le nom existe déjà, jamais écrasé)`,
  grantSummary: (p) => `Partager des données avec ${p.recipients} : ${p.items}`, grantSummaryItem: (p) => `${p.purpose} (${p.maxCalls === null ? 'sans limite d’appels' : `${p.maxCalls} ${pluralForm('fr', p.maxCalls, { one: 'appel maximum', other: 'appels maximum' })}`})`,
  testModelSummary: (p) => `Vérifier le paquet de modèle local ${p.bundleId} : l’exécuter de bout en bout sur un exemple fixe`,
  installModelSummary: (p) => `Télécharger le modèle local ${p.bundleId} : ${p.estimated ? `environ ${p.size} (taille inconnue, estimée)` : p.size}${p.resumed ? `, reprise des ${p.resumed} déjà téléchargés` : ''}, depuis ${p.source} (${p.parts})`,
  registerProjectSummary: (p) => `Enregistrer le dossier existant ${p.path} comme projet${p.name ? ` (${p.name})` : ''}`, createProjectSummary: (p) => `Créer le dossier du projet ${p.path}${p.name ? ` (${p.name})` : ''}`,
};
