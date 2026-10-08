function providerNote(p: { provider: string | null; model: string | null }): string {
  return p.provider ? ` (${p.provider}${p.model ? ` ${p.model}` : ''})` : '';
}
function originalAction(original: string): string {
  return original === 'mute' ? 'stummschalten' : original === 'keep' ? 'beibehalten' : 'absenken';
}
function transcodeAction(action: string, count: number): string {
  const files = pluralForm('de', count, { one: `${count} Datei`, other: `${count} Dateien` });
  return action === 'merge' ? `${files} in Reihenfolge zusammenführen` : action === 'extract-audio' ? `Audio aus ${files} extrahieren` : `${files} komprimieren`;
}
import { pluralForm } from '../../i18n.ts';
import type { RcFlowToolsMessages } from './rc-flow-tools.ts';

export const de: RcFlowToolsMessages = {

  listSeparator: ", ",


  transcribeVideoSummary: (p: { asset: string | null; provider: string | null; model: string | null; captions: boolean }) =>
    `Transkribieren: ${p.asset ? `Material ${p.asset}` : "das Material auf der Hauptspur"}${providerNote(p)}${p.captions ? " und eine Untertitel-Ebene hinzufügen" : ""}`,

  transcribeFileSummary: (p: { file: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Transkribieren: ${p.file}${providerNote(p)} und TXT- und SRT-Transkripte schreiben nach ${p.outDir ?? "den Downloadordner"}`,

  transcribeCreateSummary: (p: { name: string | null; file: string; provider: string | null; model: string | null; captions: boolean }) =>
    `Video erstellen${p.name ? ` „${p.name}“` : ""}, importieren: ${p.file} und in die Zeitleiste einfügen, dann transkribieren${providerNote(p)}${p.captions ? " und eine Untertitel-Ebene hinzufügen" : ""}`,


  translateVideoSummary: (p: { to: string; provider: string | null; model: string | null; captions: boolean; bilingual: boolean }) =>
    `Transkript übersetzen nach ${p.to} mit dem Textmodell${providerNote(p)}${p.captions ? ` und hinzufügen: ${p.bilingual ? "zweisprachige " : ""}Untertitel-Ebene` : ""}`,

  translateFileSummary: (p: { input: string; to: string; provider: string | null; model: string | null; outDir: string | null }) =>
    `Untertiteldatei übersetzen: ${p.input} nach ${p.to} mit dem Textmodell${providerNote(p)} und die neue Datei schreiben nach ${p.outDir ?? "den Downloadordner"}`,


  dubSummary: (p: {
    to: string | null;
    translation: string | null;
    provider: string | null;
    model: string | null;
    voice: string | null;
    original: string;
  }) =>
    `Übersetzte Vertonung${p.to ? ` (${p.to})` : ""}: ${p.translation ? `Übersetzung verwenden: ${p.translation}` : "zuerst mit dem Textmodell übersetzen"}, Satz für Satz synthetisieren${providerNote(p)}${p.voice ? ` mit Stimme ${p.voice}` : ""}, eine neue Vertonungsspur hinzufügen und den Originalton ${originalAction(p.original)}`,


  transcodeSummary: (p: { action: string; count: number; files: string; truncated: boolean; outDir: string | null }) =>
    `${transcodeAction(p.action, p.count)} (${p.files}${p.truncated ? "…" : ""}) und speichern nach ${p.outDir ?? "den Downloadordner"}`,
  transcribeReplaceSummary: (p) =>
    `Neu transkribieren: ${p.asset ? `Material ${p.asset}` : 'das Material auf der Hauptspur'}${providerNote(p)}, das aktuelle Transkript des Videos ersetzen und Übersetzungen, Untertitel und Vertonung übernehmen (ein rückgängig zu machender Schritt)`,
};
