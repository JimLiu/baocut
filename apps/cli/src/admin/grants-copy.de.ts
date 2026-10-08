import type { Grant } from '@baocut/protocol';
import type { GrantsMessages } from './grants-copy.ts';



export const de: GrantsMessages = {

  help: `Verwendung:
  baocut grants [list]             Berechtigungen zur Datenweitergabe auflisten (Online- und Agent-Anbieter):
                                   Empfänger, Datentypen, Umfang, Nutzung und Budget
    --recipient <id>               Nur Berechtigungen dieses Anbieters
    --video <video id>             Nur Berechtigungen, die dieses Video abdecken
    --include-ended                Auch widerrufene, abgelaufene und aufgebrauchte Berechtigungen auflisten
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Berechtigung erteilen. Datentypen: transcript (Transkripte und Übersetzungen), frames (Videoframes),
                                   audio (Audio), video (Originalvideo), document (Text und Prompts), context (Agent-Kontext)
    --video <video id|all>         Nur dieses Video abdecken; ohne Angabe oder mit all werden alle Videos abgedeckt
    --max-calls <n>                Aufruflimit; ohne Angabe unbegrenzt
    --budget <amount> --currency <currency>
                                   Ausgabenlimit: anhand der Modellpreise geschätzt und reserviert;
                                   Aufrufe von Modellen ohne Preise werden abgelehnt (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Ablaufzeit
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Berechtigung ändern; Einschränkungen, niedrigere Limits oder ein früherer Ablauf
                                   lehnen unter den alten Bedingungen eingereihte Aufrufe bei deren Start ab
  baocut grants revoke <id>        Berechtigung widerrufen: Spätere Aufrufe sind nicht mehr erlaubt; bereits
                                   gesendete Daten und angerechnete Kosten werden unverändert gemeldet
  baocut grants usage <id>         Nutzung einer Berechtigung und Aufgaben, die sie verwendet haben (Reservierungen und Abrechnungen)`,
  usage:
    "Usage: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]" +
    " | update <grant id> [options] | revoke <grant id> | usage <grant id>]",
  listSep: ", ",
  missingRecipient: "--recipient fehlt (der Anbieter, der die Daten empfängt, z. B. openai)",
  missingData: (kinds: readonly string[]) => `--data fehlt (Datentypen, durch Kommas getrennt: ${kinds.join(", ")})`,
  missingPurpose: "--purpose fehlt (ein Satz zum Lesen)",
  recipientFixed: "Der Empfänger lässt sich nicht ändern: Widerrufen Sie diese Berechtigung und erstellen Sie eine neue",
  nothingToUpdate: "Keine Änderungen angegeben: Geben Sie --data, --video, --purpose, --max-calls, --budget oder --expires an",
  persistOnly: "--scope, --max-calls, --budget und --expires lassen sich nur mit --persist verwenden",
  scopeChoices: "--scope erwartet video oder all",
  unknownKinds: (unknown: string, kinds: readonly string[]) => `Unbekannter Datentyp: ${unknown}. Wählen Sie aus ${kinds.join(", ")}`,
  maxCallsRange: "--max-calls muss eine ganze Zahl von 1 bis 1000000 oder none (unbegrenzt) sein",
  currencyNeedsBudget: "--currency lässt sich nur mit --budget verwenden",
  budgetFormat: "--budget muss ein nicht negativer Dezimalbetrag mit höchstens 6 Nachkommastellen sein (z. B. 5 oder 2.50)",
  budgetNeedsCurrency: "--budget erfordert --currency <Währungscode mit drei Buchstaben, z. B. USD>",
  expiresFormat: "--expires muss eine ISO-Zeit mit Zeitzone (z. B. 2026-12-31T23:59:59Z) oder none sein",
  stateLabels: {
    active: "Aktiv",
    expired: "Abgelaufen",
    revoked: "Widerrufen",
    exhausted: "Aufgebraucht",
  } satisfies Record<Grant["state"], string>,
  originLabels: {
    user: "von Ihnen erteilt",
    approval: "bei der Genehmigung erteilt",
    'provider-enable': "Standard bei Aktivierung",
  } satisfies Record<Grant["origin"], string>,
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} reserviert` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "Aufruf" : "Aufrufe"}`,
  unknownCostCalls: (n: number) => ` (${n} mit unbekannten Kosten)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) =>
    `${calls}, ${amount}${reserved ? `+${reserved} reserviert` : ""}/${cap} ${currency}`,
  noGrants: "Keine Berechtigungen: Aufrufe bei Online- und Agent-Anbietern erfordern eine Genehmigung (oder erstellen Sie eine mit baocut grants create)",
  scopeVideo: (videoId: string) => `Video ${videoId}`,
  scopeAll: "alle Videos",
  grantLine: (g: {
    id: string;
    state: string;
    recipient: string;
    kinds: string;
    scope: string;
    taskId: string | null;
    once: boolean;
    usage: string;
    expiresAt: string | null;
    origin: string;
    purpose: string;
  }) =>
    `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, nur Aufgabe ${g.taskId}` : ""}${g.once ? ", nur dieses eine Mal" : ""}  Nutzung ${g.usage}${g.expiresAt ? `, läuft ab ${g.expiresAt}` : ""}  (${g.origin}: ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `Widerrufen: ${id} (${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) =>
    `Bereits gesendet: ${calls} ${calls === 1 ? "Aufruf" : "Aufrufe"}${amount ? `, ${amount} angerechnet` : ""}${unknownCostCalls ? ` (${unknownCostCalls} mit unbekannten Kosten)` : ""}`,
  runningJobs: (jobs: readonly string[]) => `Noch laufende Aufgaben (sie werden wie gewohnt abgeschlossen): ${jobs.join(", ")}`,
  noJobs: "(Noch von keiner Aufgabe verwendet, oder die Aufgabenaufzeichnungen wurden bereinigt)",
  settled: (calls: number, amount: string, basis: string) => `abgerechnet ${calls} ${calls === 1 ? "Aufruf" : "Aufrufe"} ${amount} (${basis})`,
  unsettled: "nicht abgerechnet",
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) =>
    `  ${jobId}  ${state}  reserviert ${calls} ${calls === 1 ? "Aufruf" : "Aufrufe"} ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: "revoked" | "unverifiable" | null;
  }) =>
    `    Sendet: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (Video ${a.videoId})` : ""}: ${a.purpose}${a.estimate ? `, geschätzt ${a.estimate}` : ", Kosten unbekannt"}${a.maxCalls !== null ? `, höchstens ${a.maxCalls} ${a.maxCalls === 1 ? "Aufruf" : "Aufrufe"}` : ""}${a.reason === "revoked" ? ", Berechtigung widerrufen oder abgelaufen" : a.reason === "unverifiable" ? ", Kosten lassen sich nicht schätzen" : ""}`,
};
