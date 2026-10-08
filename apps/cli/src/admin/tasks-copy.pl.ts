import type { TasksMessages } from './tasks-copy.ts';

export const pl: TasksMessages = {
  help: "Użycie:\n  baocut tasks contract <task id> [--revision <n>]\n                                   Pokaż kontrakt zadania: cel, zakres, ograniczenia, listę zakazanych zmian,\n                                   wyniki, tryb dostępu, budżet i użycie, kontrole odbioru i rezultaty\n  baocut tasks history <task id>   Historia wersji kontraktu (kto, kiedy i które pola zmienił)\n  baocut tasks list --conversation <session id>\n                                   Najnowszy kontrakt każdego zadania sesji",
  usage: "Użycie: baocut tasks contract <task id> [--revision <n>] | history <task id> | list --conversation <session id>",
  revisionPositive: "--revision musi być dodatnią liczbą całkowitą",
  changeBy: { user: "Ty", agent: "agent", runtime: "Runtime (domyślnie)" },
  changeReason: {
    created: "utworzono",
    updated: "zmieniono",
    mode: "zmieniono tryb dostępu",
    goal: "zmieniono cel",
  },
  outcomeLabels: { passed: "Zaliczone", failed: "Niepowodzenie", skipped: "Pominięto" },
  change: (by: string, reason: string, fields: readonly string[], at: string) => `${reason} przez ${by}${fields.length > 0 ? `: ${fields.join(", ")}` : ""}, ${at}`,
  wholeVideo: "całe wideo",
  entity: (id: string) => `obiekt ${id}`,
  entityProperties: (id: string, paths: readonly string[]) => `${paths.join(", ")} obiektu ${id}`,
  frames: (sequenceId: string, from: number, to: number, trackIds: readonly string[]) => `klatki ${from}–${to} sekwencji ${sequenceId}${trackIds.length ? ` (ścieżki ${trackIds.join(", ")})` : ""}`,
  protection: (id: string, videoId: string, what: string, note: string | null) => `${id}  wideo ${videoId}: ${what}${note ? ` (${note})` : ""}`,
  noBudget: "Bez limitu (obowiązuje budżet każdego uprawnienia)",
  calls: (calls: number, reserved: number, max: number | null) => `${calls}${reserved ? `+${reserved} zarezerwowano` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "wywołanie" : "wywołań"}`,
  budget: (calls: string, spent: string | null, reserved: string | null, cap: string | null, unknownCostCalls: number) => `${calls}${spent ? `, ${spent} wydano` : ""}${reserved ? `, ${reserved} zarezerwowano` : ""}${cap ? `, limit ${cap}` : ""}${unknownCostCalls ? ` (${unknownCostCalls} z nieznanym kosztem)` : ""}`,
  latest: "najnowsza",
  latestIs: (revision: number) => `najnowsza wersja ${revision}`,
  contractHead: (taskId: string, revision: number, latest: string, change: string) => `Zadanie ${taskId}  wersja kontraktu ${revision} (${latest})  ${change}`,
  goal: (goal: string) => `Cel: ${goal}`,
  sessionVideo: (conversationId: string, videoId: string | null, baseRevision: string | null) => `Sesja: ${conversationId}  Wideo: ${videoId ?? 'none'}${baseRevision ? ` (wersja ${baseRevision})` : ""}`,
  scope: (s: {
    videoId: string | null;
    sequenceId: string | null;
    itemIds: readonly string[];
    range: { from: number; to: number } | null;
  }) => `Zakres: ${s.videoId ? `wideo ${s.videoId}` : "nie podano wideo"}${s.sequenceId ? `, sekwencja ${s.sequenceId}` : ""}${s.itemIds.length ? `, wybrano ${s.itemIds.join(", ")}` : ""}${s.range ? `, ${s.range.from}–${s.range.to} s` : ""}`,
  access: (mode: string, scopeRef: string) => `Tryb dostępu: ${mode}  Zakres uprawnień: ${scopeRef}`,
  budgetLine: (budget: string) => `Budżet: ${budget}`,
  supersedes: (taskId: string, stopped: boolean) => `Zastępuje: zadanie ${taskId} (praca poprzedniego zadania ${stopped ? "zatrzymana" : "zachowana jako propozycja"})`,
  constraints: (empty: boolean) => (empty ? "Ograniczenia: brak" : "Ograniczenia:"),
  protectedRefs: (empty: boolean) => (empty ? "Nie zmieniaj: brak" : "Nie zmieniaj:"),
  deliverable: (kind: string, stage: string, language: string | null) => `${kind}→${stage}${language ? ` (${language})` : ""}`,
  deliverables: (items: readonly string[]) => (items.length ? `Wyniki: ${items.join(", ")}` : "Wyniki: nie podano"),
  checks: (empty: boolean) => (empty ? "Kontrole odbioru: brak" : "Kontrole odbioru:"),
  outcome: (label: string, byAgent: boolean, note: string | null) => `${label} (zapisane przez ${byAgent ? "agent" : "Ty"}${note ? `: ${note}` : ""})`,
  notRecorded: "niezapisane",
  checkLine: (id: string, kind: string, required: boolean, description: string, outcome: string) => `  ${id}  [${kind}${required ? ", wymagane" : ""}] ${description} — ${outcome}`,
  noContracts: "Brak kontraktów",
  historyLine: (revision: number, change: string, mode: string) => `Wersja ${revision}  ${change}  tryb ${mode}`,
  noTasks: "Sesja nie ma jeszcze zadań",
  listLine: (taskId: string, revision: number, mode: string, goal: string) => `${taskId}  wersja ${revision}  ${mode}  ${goal}`,
};
