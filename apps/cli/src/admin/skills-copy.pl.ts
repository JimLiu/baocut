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

  skillHelp: "Użycie:\n  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <folder>] [--link] [--yes]\n                                   Zainstaluj Skill BaoCut dla agentów zewnętrznych (używanie BaoCut) w baocut/\n                                   w folderze Skills hosta: Claude Code ~/.claude/skills, Codex ~/.codex/skills,\n                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills\n    --dir <folder>                 Inny folder Skills (instalacja w baocut/ wewnątrz); wymagany bez --agent\n    --link                         Umieść Skill w <BAOCUT_HOME>/agent-skills/baocut i dowiązanie u hosta:\n                                   kolejna instalacja (dla dowolnego hosta) aktualizuje wszystkich\n    --yes                          Zastąp istniejący cel (dla dowiązania – tylko dowiązanie, nie folder docelowy);\n                                   bez parametru nic nie jest nadpisywane\n  baocut skill path                Źródło Skill BaoCut, lokalizacje instalacji każdego hosta i obecny stan\n                                   instalacji (bez Runtime)",
  targetExists: (target, linkTarget) => `${target} już istnieje (${linkTarget !== null ? `dowiązanie do ${linkTarget}` : "folder lub plik"}); nic nie zmieniono. Dodaj --yes, aby zastąpić`,
  installed: (target, files, linkTo) => pluralForm('pl', files, { one: `Skill BaoCut zainstalowano w ${target} (${files} plik${linkTo ? `, dowiązanie do ${linkTo}` : ''})`, few: `Skill BaoCut zainstalowano w ${target} (${files} pliki${linkTo ? `, dowiązanie do ${linkTo}` : ''})`, many: `Skill BaoCut zainstalowano w ${target} (${files} plików${linkTo ? `, dowiązanie do ${linkTo}` : ''})`, other: `Skill BaoCut zainstalowano w ${target} (${files} pliku${linkTo ? `, dowiązanie do ${linkTo}` : ''})` }),
  takesEffect: (host) => (host ? `Działa w nowej sesji ${host}` : "Działa w nowej sesji"),
  pathEscapes: (path) => `Ścieżka w Skill BaoCut wykracza poza folder: ${path}`,
  sourceLine: (dir) => `Źródło    ${dir ?? "not found (BaoCut isn't installed and this isn't the repository; you can set BAOCUT_AGENT_SKILLS_DIR)"}`,
  notInstalled: "Nie zainstalowano",
  linkState: (target) => `Dowiązanie → ${target}`,
  installedFolder: "Zainstalowane (folder)",
  isFile: "Plik (nie folder Skill)",
};
