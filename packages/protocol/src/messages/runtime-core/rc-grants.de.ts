const KINDS: Readonly<Record<string, string>> = { transcript: 'Transkripte und Übersetzungen', frames: 'Videoframes und Vorschaubilder', audio: 'Audio', video: 'das Originalvideo', document: 'Text und Prompts', context: 'Gesprächskontext des Agenten' };
function deKinds(codes: string): string {
  const labels = codes.split(',').filter(Boolean).map((k) => KINDS[k] ?? k);
  return new Intl.ListFormat('de', { style: 'long', type: 'conjunction' }).format(labels);
}
import { pluralForm } from '../../i18n.ts';
import type { RcGrantsMessages } from './rc-grants.ts';

export const de: RcGrantsMessages = {
  dataKinds: (p: { kinds: string }) => deKinds(p.kinds),

  grantLapsed: (p: { kinds: string; label: string; expired: boolean }) =>
    `Die Berechtigung zum Senden von ${deKinds(p.kinds)} zu ${p.label} ist ${p.expired ? "abgelaufen" : "widerrufen"}`,
  grantRequired: (p: { kinds: string; label: string }) => `Das Senden von ${deKinds(p.kinds)} zu ${p.label} benötigt die Berechtigung des Benutzers`,
  grantCallsUsedUp: (p: { used: number; max: number | null }) =>
    `Das Aufruflimit der Berechtigung (${p.used}/${p.max}) ist ausgeschöpft; dieser Aufruf würde das Budget überschreiten`,
  grantAmountUsedUp: "Das Betragslimit der Berechtigung ist ausgeschöpft; dieser Aufruf würde das Budget überschreiten",
  budgetUnverifiable: (p: { label: string }) =>
    `Die Berechtigung hat ein Betragslimit, aber für dieses Modell vom Typ ${p.label} gibt es keinen verlässlichen Preis; die Einhaltung kann daher nicht garantiert werden`,
  taskCallsUsedUp: (p: { used: number; max: number | null }) =>
    `Das Aufrufbudget dieser Aufgabe (${p.used}/${p.max}) ist ausgeschöpft; dieser Aufruf würde das Aufgabenbudget überschreiten`,
  taskAmountUsedUp: (p: { amount: string; currency: string }) =>
    `Das Betragsbudget dieser Aufgabe (${p.amount} ${p.currency}) ist ausgeschöpft; dieser Aufruf würde das Aufgabenbudget überschreiten`,
  taskBudgetUnverifiable: (p: { currency: string }) =>
    `Das Aufgabenbudget hat ein Betragslimit, aber die Kosten dieses Aufrufs können nicht geschätzt werden in ${p.currency}; die Einhaltung kann daher nicht garantiert werden`,
  combined: (p: { message: string; others: number }) =>
    `${p.message} (${p.others} weitere ${pluralForm('de', p.others, { one: "Übertragung benötigt zusätzlich", other: "Übertragungen benötigen zusätzlich" })} eine Berechtigung)`,

  hintRevoked:
    "Widerrufene oder abgelaufene Berechtigungen werden nicht automatisch wiederhergestellt. Den Benutzer bitten, in den Einstellungen von BaoCut erneut eine Berechtigung zu erteilen oder einmalig in der Sitzung zu genehmigen.",
  hintRequired:
    "Das Senden von Daten nach außen benötigt die Berechtigung des Benutzers (nach Datenart, Empfänger, Umfang und Zweck). Den Benutzer bitten, in den Einstellungen von BaoCut eine Berechtigung zu erteilen oder einmalig in der Sitzung zu genehmigen.",
  hintExhausted:
    "Ein ausgeschöpftes Budget wird nicht automatisch erhöht. Den Benutzer bitten, das Limit dieser Berechtigung zu erhöhen, oder auf laufende Aufrufe warten (fehlgeschlagene und abgebrochene Aufrufe geben ihre Reservierungen frei).",
  hintUnverifiable:
    "Wenn die Kosten nicht geschätzt werden können, kann der Benutzer nur einzelne Aufrufe genehmigen (Betrag unbekannt) oder eine Berechtigung pro Aufruf mit unbekanntem Betrag erteilen.",
  hintTaskExhausted:
    "Ein ausgeschöpftes Aufgabenbudget wird nicht automatisch erhöht. Den Benutzer bitten, das Budget dieser Aufgabe im Aufgabenvertrag zu erhöhen, oder auf laufende Aufrufe warten (fehlgeschlagene und abgebrochene Aufrufe geben ihre Reservierungen frei).",
  hintTaskUnverifiable:
    "Bei einem Aufgabenbudget mit Betragslimit werden nur Aufrufe mit Kostenschätzung in derselben Währung akzeptiert. Bei Aufrufen mit unbekannten Beträgen oder anderen Währungen kann die Einhaltung nicht garantiert werden. Den Benutzer bitten, das Betragslimit des Aufgabenbudgets zu entfernen (nur Aufruflimit beibehalten), oder ein Modell mit Preis wählen.",
  hintServiceAuto:
    "Die Stufe auto eines externen Dienstes ist keine Berechtigung zum Senden von Daten nach außen. Den Benutzer bitten, in BaoCut für diesen Anbieter eine Berechtigung zu erteilen (Datenarten, Umfang und Budget), oder die Dienststufe zu ask ändern, um jeden Aufruf zu genehmigen.",

  placeholderPurpose: "<purpose>",
  placeholderMaxCalls: "<higher call count>",
  placeholderBudget: "<higher amount>",
  placeholderCalls: "<call count>",

  grantLapsedBeforeStart: (p: { state: string }) =>
    `Die Berechtigung ${p.state === "abgelaufen" ? "abgelaufen" : p.state === "widerrufen" ? "wurde widerrufen" : "wurde eingeschränkt"} vor Aufgabenbeginn; keine Daten wurden gesendet`,
  grantInvalidBeforeStart: "Die Berechtigung wurde vor Aufgabenbeginn ungültig; keine Daten wurden gesendet",
  retrySkipped: (p: { reason: string }) => `Der automatische erneute Versuch wurde nicht ausgeführt: ${p.reason}`,
  ledgerUnsaved: "Das Berechtigungsverzeichnis konnte nicht auf die Festplatte geschrieben werden; keine Daten wurden gesendet",
  providerDisabledBeforeStart: "Der Anbieter wurde vor Aufgabenbeginn ausgeschaltet; keine Daten wurden gesendet",

  noSuchGrant: "Keine solche Berechtigung",
  toolPurpose: (p: { tool: string }) => `Werkzeug „${p.tool}“`,
  pipelinePurpose: (p: { label: string }) => `Pipeline „${p.label}“`,
};
