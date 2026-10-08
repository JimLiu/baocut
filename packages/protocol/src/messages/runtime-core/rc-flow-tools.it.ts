import type { RcFlowToolsMessages } from './rc-flow-tools.ts';
import { pluralForm } from '../../i18n.ts';

function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}
function originalLabel(original: string): string {
  switch (original) { case 'mute': return 'disattiva'; case 'keep': return 'mantieni'; default: return 'abbassa'; }
}
function transcodeAction(action: string, count: number): string {
  const files = `${count} file`;
  switch (action) { case 'merge': return `Unisci ${files} in ordine`; case 'extract-audio': return `Estrai audio da ${files}`; default: return `Comprimi ${files}`; }
}

export const it: RcFlowToolsMessages = {
  listSeparator: ', ',
  transcribeVideoSummary: (p) => `Trascrivi ${p.asset ? `il materiale ${p.asset}` : 'il materiale sulla traccia principale'}${providerNote(p)}${p.captions ? ' e aggiungi un livello di sottotitoli' : ''}`,
  transcribeFileSummary: (p) => `Trascrivi ${p.file}${providerNote(p)} e scrivi le trascrizioni TXT e SRT ${p.outDir === null ? 'nella cartella Download' : `in ${p.outDir}`}`,
  transcribeCreateSummary: (p) => `Crea video${p.name ? ` «${p.name}»` : ''}, importa ${p.file} e aggiungilo alla timeline, poi trascrivilo${providerNote(p)}${p.captions ? ' e aggiungi un livello di sottotitoli' : ''}`,
  translateVideoSummary: (p) => `Traduci la trascrizione in ${p.to} con il modello di testo${providerNote(p)}${p.captions ? ` e aggiungi un livello di sottotitoli${p.bilingual ? ' bilingue' : ''}` : ''}`,
  translateFileSummary: (p) => `Traduci il file di sottotitoli ${p.input} in ${p.to} con il modello di testo${providerNote(p)} e scrivi il nuovo file ${p.outDir === null ? 'nella cartella Download' : `in ${p.outDir}`}`,
  dubSummary: (p) => `Doppiaggio tradotto${p.to ? ` (${p.to})` : ''}: ${p.translation ? `usa la traduzione ${p.translation}` : 'traduci prima con il modello di testo'}, sintetizza frase per frase${providerNote(p)}${p.voice ? ` con la voce ${p.voice}` : ''}, aggiungi una nuova traccia di doppiaggio e ${originalLabel(p.original)} l’audio originale`,
  transcodeSummary: (p) => `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? '…' : ''}) e salva ${p.outDir === null ? 'nella cartella Download' : `in ${p.outDir}`}`,
  transcribeReplaceSummary: (p) =>
    `Ritrascrivi ${p.asset ? `il materiale ${p.asset}` : 'il materiale sulla traccia principale'}${providerNote(p)} e sostituisci la trascrizione attuale del video riportando traduzioni, sottotitoli e doppiaggio (un’unica operazione annullabile)`,
};
