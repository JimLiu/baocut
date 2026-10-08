import type { ApprovalsMessages } from './approvals-copy.ts';

export const pl: ApprovalsMessages = {
  help: "Użycie:\n  baocut approvals                 Lista oczekujących zatwierdzeń z sesji i usług zewnętrznych\n  baocut approvals allow <id>      Zezwól na oczekujące zatwierdzenie; udostępnianie danych domyślnie\n                                   dozwolone tylko jednorazowo (koszt nieznany)\n    --persist                      Przyznaj też stałe uprawnienie (to samo udostępnianie już nie pyta)\n    --scope <video|all>            Zakres stałego uprawnienia: wideo tego wywołania (domyślnie) lub wszystkie wideo\n    --max-calls <n>                Limit wywołań stałego uprawnienia\n    --budget <amount> --currency <currency>\n                                   Limit wydatków stałego uprawnienia (tylko modele z cenami;\n                                   wywołania bez szacunku kosztu wymagają zatwierdzenia za każdym razem)\n    --expires <ISO time>           Czas wygaśnięcia stałego uprawnienia\n  baocut approvals deny <id>       Odmów oczekującego zatwierdzenia",
  persistNeedsAllow: "--persist dotyczy tylko allow",
  alreadyResolved: (id) => `Zatwierdzenie ${id} zostało już obsłużone, wygasło, anulowano lub nie istnieje`,
  allowed: (id) => `Zezwolono ${id}`,
  denied: (id) => `Odmówiono ${id}`,
  unknownMode: (value: string, flags: readonly string[]) => `Nieznany tryb dostępu: ${value}. --mode przyjmuje ${flags.join(", ")}`,
  mode: (label: string, flag: string) => `${label} (${flag})`,
  usage: "Użycie: baocut approvals [list | allow <approval id> | deny <approval id>]",
  riskLabels: { read: "Odczyt", edit: "Edytuj", command: "Polecenie", high: "Wysokie ryzyko" },
  none: "Brak oczekujących zatwierdzeń",
  fromSession: (title: string) => `Sesja „${title}"`,
  fromService: (serviceId: string, clientName: string) => `Usługa ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `tryb ${mode}`,
  basisLevel: (level: string) => `poziom ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(", ")}` : ""}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? "" : `, automatycznie odmówiono w ${a.secondsLeft} s`})`,
  runCommand: (command: string) => `Uruchom polecenie: ${command}`,
  changeFiles: (files: readonly string[]) => `Zmień pliki: ${files.join(", ")}`,
  callTool: (tool: string, files: readonly string[]) => `Wywołaj ${tool}${files.length > 0 ? `: ${files.join(", ")}` : ""}`,
};
