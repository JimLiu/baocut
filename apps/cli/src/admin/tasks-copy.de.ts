import type { TaskContract, CheckResult } from '@baocut/protocol';
import type { TasksMessages } from './tasks-copy.ts';



export const de: TasksMessages = {

  help: `Verwendung:
  baocut tasks contract <task id> [--revision <n>]
                                   Aufgabenvertrag anzeigen: Ziel, Umfang, Einschränkungen, unveränderliche Elemente,
                                   Liefergegenstände, Zugriffsmodus, Budget und Nutzung, Abnahmeprüfungen und Ergebnisse
  baocut tasks history <task id>   Revisionsverlauf des Vertrags (wer welche Felder wann geändert hat)
  baocut tasks list --conversation <session id>
                                   Aktuellsten Vertrag jeder Aufgabe einer Sitzung anzeigen`,
  usage: "Verwendung: baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>",
  revisionPositive: "--revision muss eine positive ganze Zahl sein",
  changeBy: { user: "Sie", agent: "der Agent", runtime: "Runtime (Standard)" } satisfies Record<TaskContract["change"]["by"], string>,
  changeReason: {
    created: "erstellt",
    updated: "geändert",
    mode: "Zugriffsmodus gewechselt",
    goal: "Ziel geändert",
  } satisfies Record<TaskContract["change"]["reason"], string>,
  outcomeLabels: { passed: "Bestanden", failed: "Fehlgeschlagen", skipped: "Übersprungen" } satisfies Record<CheckResult["outcome"], string>,
  change: (by: string, reason: string, fields: readonly string[], at: string) =>
    `${reason} von ${by}${fields.length > 0 ? `: ${fields.join(", ")}` : ""}, ${at}`,
  wholeVideo: "das gesamte Video",
  entity: (id: string) => `Entität ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `${paths.join(", ")} der Entität ${id}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) =>
    `Frames ${from}–${to} der Sequenz ${sequenceId}${trackIds.length ? ` (Spuren ${trackIds.join(", ")})` : ""}`,
  protection: (id: string, videoId: string, what: string, note: string | null) =>
    `${id}  Video ${videoId}: ${what}${note ? ` (${note})` : ""}`,
  noBudget: "Unbegrenzt (nur das Budget der einzelnen Berechtigungen gilt)",
  calls: (calls: number, reserved: number, max: number | null) =>
    `${calls}${reserved ? `+${reserved} reserviert` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "Aufruf" : "Aufrufe"}`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) =>
    `${calls}${spent ? `, ${spent} ausgegeben` : ""}${reserved ? `, ${reserved} reserviert` : ""}${cap ? `, Obergrenze ${cap}` : ""}${unknownCostCalls ? ` (${unknownCostCalls} mit unbekannten Kosten)` : ""}`,
  latest: "aktuell",
  latestIs: (revision: number) => `aktuell ist Revision ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) =>
    `Aufgabe ${taskId}  Vertragsrevision ${revision} (${latest})  ${change}`,
  goal: (goal: string) => `Ziel: ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) =>
    `Sitzung: ${conversationId}  Video: ${videoId ?? "keine"}${baseRevision ? ` (Version ${baseRevision})` : ""}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) =>
    `Umfang: ${s.videoId ? `Video ${s.videoId}` : "kein Video angegeben"}${s.sequenceId ? `, Sequenz ${s.sequenceId}` : ""}${s.itemIds.length ? `, ausgewählt ${s.itemIds.join(", ")}` : ""}${s.range ? `, ${s.range.from}–${s.range.to} s` : ""}`,
  access: (mode: string, scopeRef: string) => `Zugriffsmodus: ${mode}  Berechtigungsumfang: ${scopeRef}`,
  budgetLine: (budget: string) => `Budget: ${budget}`,
  supersedes: (taskId: string, stopped: boolean) =>
    `Ersetzt: Aufgabe ${taskId} (die Arbeit der alten Aufgabe ${stopped ? "wurde gestoppt" : "bleibt als Kandidat erhalten"})`,
  constraints: (empty: boolean): string => (empty ? "Einschränkungen: keine" : "Einschränkungen:"),
  protectedRefs: (empty: boolean): string => (empty ? "Nicht ändern: keine Vorgaben" : "Nicht ändern:"),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? ` (${language})` : ""}`,
  deliverables: (items: readonly string[]) => (items.length ? `Liefergegenstände: ${items.join(", ")}` : "Liefergegenstände: nicht angegeben"),
  checks: (empty: boolean): string => (empty ? "Abnahmeprüfungen: keine" : "Abnahmeprüfungen:"),
  outcome: (label: string, byAgent: boolean, note: string | null) =>
    `${label} (erfasst von ${byAgent ? "der Agent" : "Sie"}${note ? `: ${note}` : ""})`,
  notRecorded: "nicht erfasst",
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) =>
    `  ${id}  [${kind}${required ? ", erforderlich" : ""}] ${description} — ${outcome}`,
  noContracts: "Keine Verträge",
  historyLine: (revision: number, change: string, mode: string) => `Revision ${revision}  ${change}  Modus ${mode}`,
  noTasks: "Diese Sitzung hat noch keine Aufgaben",
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  Revision ${revision}  ${mode}  ${goal}`,
};
