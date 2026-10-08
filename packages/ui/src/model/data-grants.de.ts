const times = (n: number) => pluralForm('de', n, { one: `${n} Aufruf`, other: `${n} Aufrufe` });
import type { GrantState } from "@baocut/protocol";
import type { Grant } from "@baocut/protocol";
import { pluralForm } from '@baocut/protocol';
import type { DataGrantsMessages } from './data-grants.ts';

export const de: DataGrantsMessages = {
  state: { active: "Aktiv", expired: "Abgelaufen", revoked: "Widerrufen", exhausted: "Limit erreicht" } as Record<GrantState, string>,
  kindList: (kinds: readonly string[]) => kinds.join(", "),
  noKinds: "Keine Datenarten",
  origin: {
    'provider-enable': "Standardmäßig bei Anbieteraktivierung erteilt",
    approval: "Bei Genehmigung erteilt",
    user: "Manuell erteilt",
  } as Record<Grant['origin'], string>,
  oneVideoNamed: (name: string) => `Nur das Video „${name}“`,
  oneVideo: "Nur ein Video",
  allVideos: "Alle Videos",
  oneTask: "Nur eine Aufgabe",
  budgetCap: (amount: string) => `Ausgabenlimit ${amount}`,
  budgetUnknown: "Kosten unbekannt; nur Aufrufe zählen",
  once: "Nur dieses Mal",
  unlimited: "Unbegrenzte Aufrufe",
  maxCalls: (n: number) => `Bis zu ${times(n)}`,
  revokedOn: (day: string) => `Widerrufen: ${day}`,
  expiredOn: (day: string) => `Abgelaufen: ${day}`,
  expiresOn: (day: string) => `Läuft ab: ${day}`,
  neverUsed: "Noch nicht verwendet",
  usedWithAmount: (calls: number, amount: string) => `Verwendet: ${times(calls)} (${amount})`,
  used: (calls: number) => `Verwendet: ${times(calls)}`,
  reservedWithAmount: (calls: number, amount: string) => `${times(calls)} laufend (${amount} reserviert)`,
  reserved: (calls: number) => `${times(calls)} laufend`,
  unknownCost: (calls: number) => `${times(calls)} mit unbekannten Kosten`,
  usageSeparator: ", ",
  revokeConfirm: (running: number, sent: number) =>
    [
      "Nach Widerruf werden neue und eingereihte Aufrufe mit dieser Berechtigung abgelehnt.",
      running ? `${times(running)} bereits laufende werden normal abgeschlossen.` : "",
      sent ? `Bereits gesendete Daten in ${times(sent)} und angefallene Kosten lassen sich nicht zurücknehmen.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  revoked: "Widerrufen",
  sentBefore: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `Zuvor gesendet: ${times(calls)}${amount ? ` (${amount}${unknownCostCalls ? `, zusätzlich ${times(unknownCostCalls)} mit unbekannten Kosten` : ""})` : ""}`,
  runningJobs: (n: number) => (pluralForm('de', n, { one: "1 laufende Aufgabe wird normal abgeschlossen", other: `${n} laufende Aufgaben werden normal abgeschlossen` })),
};
