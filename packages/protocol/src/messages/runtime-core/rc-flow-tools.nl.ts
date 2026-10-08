function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}
function originalAction(original: string): string {
  return original === 'mute' ? 'dempen' : original === 'keep' ? 'behouden' : 'verlagen';
}
function transcodeAction(action: string, count: number): string {
  const files = pluralForm('nl', count, { one: `${count} bestand`, other: `${count} bestanden` });
  return action === 'merge' ? `${files} in volgorde samenvoegen` : action === 'extract-audio' ? `Audio extraheren uit ${files}` : `${files} comprimeren`;
}
import { pluralForm } from '../../i18n.ts';
import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

export const nl: RcFlowToolsMessages = {

  listSeparator: ", ",


  transcribeVideoSummary: (p: { asset: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Transcriberen: ${p.asset ? `media ${p.asset}` : "de media op het hoofdspoor"}${providerNote(p)}${p.captions ? " en een ondertitellaag toevoegen" : ""}`,

  transcribeFileSummary: (p: { file: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Transcriberen: ${p.file}${providerNote(p)} en TXT- en SRT-transcripten schrijven naar ${p.outDir ?? "de downloadmap"}`,

  transcribeCreateSummary: (p: { name: string | null; file: string; provider: string | null; model: string | null; captions: boolean }) =>
    `Video maken${p.name ? ` ‘${p.name}’` : ""}, importeren: ${p.file} en toevoegen aan de tijdlijn, daarna transcriberen${providerNote(p)}${p.captions ? " en een ondertitellaag toevoegen" : ""}`,


  translateVideoSummary: (p: { to: string; provider: string | null; model: string | null; captions: boolean; bilingual: boolean }) =>
    `Transcript vertalen naar ${p.to} met het tekstmodel${providerNote(p)}${p.captions ? ` en toevoegen: ${p.bilingual ? "tweetalige " : ""}ondertitellaag` : ""}`,

  translateFileSummary: (p: { input: string; to: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Ondertitelbestand vertalen: ${p.input} naar ${p.to} met het tekstmodel${providerNote(p)} en het nieuwe bestand schrijven naar ${p.outDir ?? "de downloadmap"}`,


  dubSummary: (p: {
    to: string | null;
    translation: string | null;
    provider: string | null;
    model: string | null;
    voice: string | null;
    original: string;
  }) =>
    `Vertaalde nasynchronisatie${p.to ? ` (${p.to})` : ""}: ${p.translation ? `vertaling gebruiken: ${p.translation}` : "eerst vertalen met het tekstmodel"}, zin voor zin synthetiseren${providerNote(p)}${p.voice ? ` met stem ${p.voice}` : ""}, een nieuw nasynchronisatiespoor toevoegen en de oorspronkelijke audio ${originalAction(p.original)}`,


  transcodeSummary: (p: { action: string; count: number; files: string; truncated: boolean; outDir: string | null }) =>
    `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? "…" : ""}) en opslaan naar ${p.outDir ?? "de downloadmap"}`,
  transcribeReplaceSummary: (p) =>
    `Opnieuw transcriberen: ${p.asset ? `media ${p.asset}` : 'de media op het hoofdspoor'}${providerNote(p)}, het huidige transcript van de video vervangen en vertalingen, ondertitels en nasynchronisatie overnemen (één stap die ongedaan kan worden gemaakt)`,
};
