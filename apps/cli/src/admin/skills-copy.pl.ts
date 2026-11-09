import { pluralForm } from '@baocut/protocol';
import type { SkillsMessages } from './skills-copy.ts';

export const pl: SkillsMessages = {
  skillsHelp: "Użycie:\n  baocut skills add <folder>       Skopiuj lokalny folder Skill (SKILL.md w głównym folderze)\n                                   do <BAOCUT_HOME>/skills, domyślnie włączony\n  baocut skills import <source>    Importuj Skill z GitHub: owner/repo, URL repozytorium lub\n                                   …/tree/<branch>/<folder>; domyślnie wyłączony, sprawdź przed włączeniem\n    --id <id>                      Dla add i import: inne id (domyślnie z nazwy folderu;\n                                   istniejące id jest odrzucane, bez nadpisywania)\n  baocut skills enable|disable <id>\n                                   Włącz / wyłącz Skill: działa od kolejnej nowej sesji agenta\n  baocut skills remove <id>        Usuń dodany lub importowany Skill (wbudowane można tylko wyłączyć)",
  added: "Dodano",
  imported: "Zaimportowano",
  turnedOn: "Włączono",
  turnedOff: "Wyłączone",
  reviewFirst: (id) => `Najpierw przejrzyj (baocut skills read ${id}), potem włącz przez baocut skills enable ${id}`,
  takesEffectNextSession: "Działa od kolejnej nowej sesji agenta; trwające sesje bez zmian",
  removed: (id, path) => `Usunięto: ${id} (${path})`,
  localSource: (path, addedAt) => `folder lokalny ${path} (${addedAt})`,
  remoteSource: (url, ref, commit, importedAt) => `${url} (${ref}@${commit}, ${importedAt})`,
  changed: (verb, id, name, enabled, path, source) => `${verb} ${id} (${name}, ${enabled ? "wł." : "wył."}) → ${path}${source ? `
Źródło: ${source}` : ""}`,
  idFormat: (flag, value) => `${flag} przyjmuje id Skill (małe litery, słowa z łącznikami, zobacz baocut skills): ${value}`,

  skillHelp: `Użycie:
  baocut skill install [--dir <folder>]… [--agent agents|claude] [--copy]
                                   Instaluje skill BaoCut dla zewnętrznych agentów (jak używać BaoCut). Domyślnie w
                                   ~/.agents/skills/baocut (Codex i inni agenci) oraz ~/.claude/skills/baocut (Claude Code),
                                   jako dowiązania do skilla w aplikacji BaoCut, więc aktualizuje się razem z aplikacją
    --dir <folder>                 Zamiast tego instaluje w <folder>/.agents/skills i <folder>/.claude/skills: dowolny
                                   folder, nie tylko projekt BaoCut; powtórz dla kilku folderów
    --agent agents|claude          Tylko jedno z dwóch: .agents/skills albo .claude/skills
    --copy                         Kopiuje zamiast dowiązywać (kopia nie śledzi aktualizacji: zainstaluj ponownie)
  baocut skill status              Wersja skilla w aplikacji, gdzie jest zainstalowany i czy każde miejsce jest aktualne,
                                   oraz polecenie baocut w terminalu
  baocut skill remove [--dir <folder>]… [--agent agents|claude] [--yes]
                                   Usuwa: dla dowiązania znika tylko dowiązanie; usunięcie kopii wymaga --yes.
                                   To, co jest w baocut/ i nie jest skillem BaoCut, nigdy nie jest zastępowane ani usuwane`,
  installedAt: (path, linkTarget) => `Zainstalowano: ${path}${linkTarget ? ` → ${linkTarget}` : ' (kopia)'}`,
  takesEffect: 'Działa w nowej sesji agenta',
  removedAt: (path) => `Usunięto: ${path}`,
  removeCopies: (paths) =>
    `${paths.join(', ')} — ${paths.length === 1 ? 'to kopia' : 'to kopie'}: usunięcie skasuje pliki razem ze zmianami wprowadzonymi w nich. Dodaj --yes, aby usunąć`,
  unknownAgent: (value) => `--agent przyjmuje agents (.agents/skills) albo claude (.claude/skills): ${value}`,
  fixHint: 'Niektóre instalacje są nieaktualne lub uszkodzone: baocut skill install (z tym samym --dir) je naprawi',
  statusSkill: (version, source, bundled) => `Skill     ${version ?? '?'}  ${source}${bundled ? '' : ' (wersja deweloperska: generowany przez Runtime)'}`,
  statusCli: (entry) => `CLI       ${entry ?? 'nie dołączone (wersja deweloperska)'}`,
  statusOnPath: (path, target, fromApp) => `Terminal  ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (z tej aplikacji)' : ' (nie z tej aplikacji)'}`,
  statusNotOnPath: (command) => `Terminal  baocut nie ma w PATH${command ? `; aby używać go w każdym terminalu: ${command}` : ''}`,
  appOutsideApplications: 'BaoCut nie działa z folderu Aplikacje: dowiązania przestaną działać, jeśli przeniesiesz lub usuniesz aplikację',
  globalHeading: 'Globalnie',
  state: { none: 'Nie zainstalowano', current: 'Aktualny', stale: 'Nieaktualny', broken: 'Uszkodzone dowiązanie', foreign: 'Jest tam coś innego (bez zmian)' },
  mode: { link: 'Dowiązanie', copy: 'Kopia' },

  cliHelp: `Użycie:
  baocut cli install               Umieszcza baocut w PATH, wskazując na wiersz poleceń w aplikacji BaoCut. macOS: dowiązanie
                                   w ~/.local/bin/baocut. Windows: %LOCALAPPDATA%\\BaoCut\\bin\\baocut.cmd, a ten folder
                                   zostaje dodany do PATH użytkownika. Nie wymaga uprawnień administratora
  baocut cli status                Gdzie jest baocut, czy wskazuje na tę aplikację i które baocut znajduje terminal
  baocut cli remove                Usuwa to, co umieściło baocut cli install. To, co jest w tym miejscu, a czego nie umieścił
                                   BaoCut, nigdy nie jest zastępowane ani usuwane`,
  cliStatusEntry: (path, target, state) => `Polecenie ${path}${target ? ` → ${target}` : ''} · ${state}`,
  cliStatusApp: (entry) => `Aplikacja ${entry ?? 'brak dołączonego wiersza poleceń (wersja deweloperska): zainstaluj baocut z aplikacji BaoCut'}`,
  cliStatusTerminal: (found) => `Terminal  ${found ?? 'nie znaleziono baocut'}`,
  cliStatusUnchecked: 'Terminal  nie udało się sprawdzić PATH terminala: otwórz nowy terminal i uruchom baocut version',
  cliShadowed: (found, dir) => `Terminal  najpierw znajduje ${found}. Aby używać tego, usuń tamto albo przesuń ${dir} wcześniej w PATH`,
  cliPathHint: (dir, line, file) =>
    `${dir} nie jest jeszcze w PATH terminala. Dodaj ten wiersz do ${file ?? 'konfiguracji powłoki'}, a potem otwórz nowy terminal:\n  ${line}`,
  cliInstalled: (path, target) => `Zainstalowano: ${path} → ${target}`,
  cliWindowsPath: (dir) => `${dir} jest w PATH użytkownika: otwórz nowy terminal, aby używać baocut`,
  cliRemoved: (path) => `Usunięto: ${path}`,
  cliNothingToRemove: (path) => `Nic do usunięcia w ${path}`,
  cliInstallHint: 'baocut cli install umieszcza baocut w PATH',
  cliFixHint: 'baocut cli install przestawi je na tę aplikację',
  cliState: { none: 'Nie zainstalowano', current: 'Wskazuje na tę aplikację', stale: 'Wskazuje na inne BaoCut', broken: 'Wskazuje na miejsce, które już nie istnieje', foreign: 'Jest tam coś innego (bez zmian)' },
};
