import type { RcFlowToolsMessages } from './rc-flow-tools.ts';
import { pluralForm } from '../../i18n.ts';

function providerNote(p: { provider: string | null; model: string | null }): string { return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : ''; }
function originalAction(original: string): string { switch (original) { case 'mute': return 'couper'; case 'keep': return 'conserver'; default: return 'atténuer'; } }
function transcodeAction(action: string, count: number): string {
  const files = `${count} ${pluralForm('fr', count, { one: 'fichier', other: 'fichiers' })}`;
  switch (action) { case 'merge': return `Fusionner ${files} dans l’ordre`; case 'extract-audio': return `Extraire l’audio de ${files}`; default: return `Compresser ${files}`; }
}

export const fr: RcFlowToolsMessages = {
  listSeparator: ', ',
  transcribeVideoSummary: (p) => `Transcrire ${p.asset ? `le média ${p.asset}` : 'le média sur la piste principale'}${providerNote(p)}${p.captions ? ' et ajouter un calque de sous-titres' : ''}`,
  transcribeFileSummary: (p) => `Transcrire ${p.file}${providerNote(p)} et écrire les transcriptions TXT et SRT dans ${p.outDir ?? 'le dossier Téléchargements'}`,
  transcribeCreateSummary: (p) => `Créer une vidéo${p.name ? ` « ${p.name} »` : ''}, importer ${p.file} et l’ajouter à la timeline, puis le transcrire${providerNote(p)}${p.captions ? ' et ajouter un calque de sous-titres' : ''}`,
  translateVideoSummary: (p) => `Traduire la transcription en ${p.to} avec le modèle de texte${providerNote(p)}${p.captions ? ` et ajouter un calque de sous-titres${p.bilingual ? ' bilingue' : ''}` : ''}`,
  translateFileSummary: (p) => `Traduire le fichier de sous-titres ${p.input} en ${p.to} avec le modèle de texte${providerNote(p)} et écrire le nouveau fichier dans ${p.outDir ?? 'le dossier Téléchargements'}`,
  dubSummary: (p) => `Doublage traduit${p.to ? ` (${p.to})` : ''} : ${p.translation ? `utiliser la traduction ${p.translation}` : 'traduire d’abord avec le modèle de texte'}, synthétiser phrase par phrase${providerNote(p)}${p.voice ? ` avec la voix ${p.voice}` : ''}, ajouter une nouvelle piste de doublage et ${originalAction(p.original)} l’audio original`,
  transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? '…' : ''}) et enregistrer dans ${p.outDir ?? 'le dossier Téléchargements'}`,
  transcribeReplaceSummary: (p) =>
    `Retranscrire ${p.asset ? `le média ${p.asset}` : 'le média de la piste principale'}${providerNote(p)} et remplacer la transcription actuelle de la vidéo en reportant traductions, sous-titres et doublage (une seule opération annulable)`,
};
