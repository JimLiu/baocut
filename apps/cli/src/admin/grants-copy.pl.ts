import { pluralForm } from '@baocut/protocol';
import type { GrantsMessages } from './grants-copy.ts';

export const pl: GrantsMessages = {
  help: "Użycie:\n  baocut grants [list]             Lista uprawnień wysyłania danych (dostawcy online i agenci):\n                                   odbiorca, typy danych, zakres, użycie i budżet\n    --recipient <id>               Tylko uprawnienia dostawcy\n    --video <video id>             Tylko uprawnienia obejmujące wideo\n    --include-ended                Także cofnięte, wygasłe i wykorzystane\n  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]\n                                   Przyznaj uprawnienie. Typy: transcript (transkrypcje i tłumaczenia), frames (klatki),\n                                   audio (audio), video (oryginalne wideo), document (tekst i prompty), context (kontekst agenta)\n    --video <video id|all>         Tylko to wideo; bez parametru lub all – wszystkie wideo\n    --max-calls <n>                Limit wywołań; bez parametru bez limitu\n    --budget <amount> --currency <currency>\n                                   Limit wydatków: szacunek i rezerwacja według ceny modelu;\n                                   modele bez cen odrzucane (BUDGET_UNVERIFIABLE)\n    --expires <ISO time>           Czas wygaśnięcia\n  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]\n                         [--budget <amount|none> --currency …] [--expires <time|none>]\n                                   Zmień uprawnienie; zawężenie, obniżenie limitu lub skrócenie terminu\n                                   odrzuca kolejkowane wywołania ze starych warunków przy uruchomieniu\n  baocut grants revoke <id>        Cofnij uprawnienie: dalsze wywołania zabronione; wysłane dane\n                                   i naliczone koszty zgłaszane bez zmian\n  baocut grants usage <id>         Użycie uprawnienia i zadania (rezerwacje i rozliczenia)",
  usage:
    'Usage: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' +
    ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]',
  listSep: ", ",
  missingRecipient: "Brak --recipient (dostawca otrzymujący dane, np. openai)",
  missingData: (kinds: readonly string[]) => `Brak --data (typy danych oddzielone przecinkami: ${kinds.join(", ")})`,
  missingPurpose: "Brak --purpose (jedno zdanie dla użytkownika)",
  recipientFixed: "Nie można zmienić odbiorcy: cofnij uprawnienie i utwórz nowe",
  nothingToUpdate: "Brak zmian: podaj --data, --video, --purpose, --max-calls, --budget lub --expires",
  persistOnly: "--scope, --max-calls, --budget i --expires tylko z --persist",
  scopeChoices: "--scope przyjmuje video lub all",
  unknownKinds: (unknown: string, kinds: readonly string[]) => `Nieznany typ danych: ${unknown}. Wybierz z ${kinds.join(", ")}`,
  maxCallsRange: "--max-calls musi być liczbą całkowitą od 1 do 1000000 lub none (bez limitu)",
  currencyNeedsBudget: "--currency tylko z --budget",
  budgetFormat: "--budget musi być nieujemną kwotą dziesiętną do 6 miejsc po przecinku (np. 5 lub 2.50)",
  budgetNeedsCurrency: "--budget wymaga --currency <trzyliterowy kod waluty, np. USD>",
  expiresFormat: "--expires musi być czasem ISO ze strefą (np. 2026-12-31T23:59:59Z) lub none",
  stateLabels: {
    active: "Aktywny",
    expired: "Wygasło",
    revoked: "Cofnięto",
    exhausted: "Wykorzystane",
  },
  originLabels: {
    user: "przyznane przez Ciebie",
    approval: "przyznane przy zatwierdzeniu",
    'provider-enable': "domyślne po włączeniu",
  },
  calls: (calls: number, reserved: number, max: number | null) => `${calls}${reserved ? `+${reserved} zarezerwowano` : ""}${max !== null ? `/${max}` : ""} ${max === null && calls === 1 && !reserved ? "wywołanie" : "wywołań"}`,
  unknownCostCalls: (n: number) => ` (${n} z nieznanym kosztem)`,
  callsAndAmount: (calls: string, amount: string, reserved: string | null, cap: string, currency: string) => `${calls}, ${amount}${reserved ? `+${reserved} zarezerwowano` : ""}/${cap} ${currency}`,
  noGrants: "Brak uprawnień: wywołania dostawców online i agentów wymagają zatwierdzenia (lub utwórz przez baocut grants create)",
  scopeVideo: (videoId: string) => `wideo ${videoId}`,
  scopeAll: "wszystkie wideo",
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
  }) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, tylko zadanie ${g.taskId}` : ""}${g.once ? ", tylko jednorazowo" : ""}  użycie ${g.usage}${g.expiresAt ? `, wygasa ${g.expiresAt}` : ""}  (${g.origin}: ${g.purpose})`,
  revoked: (id: string, recipient: string, kinds: string) => `Cofnięto ${id} (${recipient} ← ${kinds})`,
  alreadySent: (calls: number, amount: string | null, unknownCostCalls: number) => `Już wysłano: ${calls} ${pluralForm('pl', calls, { one: "wywołanie", few: "wywołania", many: "wywołań", other: "wywołania" })}${amount ? `, ${amount} naliczono` : ""}${unknownCostCalls ? ` (${unknownCostCalls} z nieznanym kosztem)` : ""}`,
  runningJobs: (jobs: readonly string[]) => `Zadania nadal trwają (skończą normalnie): ${jobs.join(", ")}`,
  noJobs: "(Żadne zadanie jeszcze nie użyło lub zapisy usunięto)",
  settled: (calls: number, amount: string, basis: string) => `rozliczono ${calls} ${pluralForm('pl', calls, { one: "wywołanie", few: "wywołania", many: "wywołań", other: "wywołania" })} ${amount} (${basis})`,
  unsettled: "nierozliczone",
  jobLine: (jobId: string, state: string, calls: number, amount: string, settled: string) => `  ${jobId}  ${state}  zarezerwowano ${calls} ${pluralForm('pl', calls, { one: "wywołanie", few: "wywołania", many: "wywołań", other: "wywołania" })} ${amount}  ${settled}`,
  approvalGrant: (a: {
    recipient: string;
    kinds: string;
    videoId: string | null;
    purpose: string;
    estimate: string | null;
    maxCalls: number | null;
    reason: 'revoked' | 'unverifiable' | null;
  }) => `    Wysyła: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (wideo ${a.videoId})` : ""}: ${a.purpose}${a.estimate ? `, szacunek ${a.estimate}` : ", koszt nieznany"}${a.maxCalls !== null ? `, najwyżej ${a.maxCalls} ${pluralForm('pl', a.maxCalls, { one: "wywołanie", few: "wywołania", many: "wywołań", other: "wywołania" })}` : ""}${a.reason === 'revoked' ? ", uprawnienie cofnięte lub wygasłe" : a.reason === 'unverifiable' ? ", koszt nie może być oszacowany" : ""}`,
};
