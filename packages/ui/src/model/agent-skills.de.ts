import type { SkillOrigin } from "@baocut/protocol";
type SkillAction = 'load' | 'toggle' | 'add' | 'import' | 'remove' | 'read' | 'send';
import { pluralForm } from '@baocut/protocol';
import type { AgentSkillsMessages } from './agent-skills.ts';

export const de: AgentSkillsMessages = {
  origin: { builtin: "Eingebaut", personal: "Meine", 'third-party': "Drittanbieter" } as Record<SkillOrigin, string>,
  all: "Alle",
  commit: (sha: string) => ` (${sha})`,
  bytes: (n: number) => (pluralForm('de', n, { one: "1 Byte", other: `${n} Bytes` })),
  action: {
    load: "Skills laden",
    toggle: "umschalten",
    add: "hinzufügen",
    import: "importieren",
    remove: "entfernen",
    read: "Datei öffnen",
    send: "senden",
  } as Record<SkillAction, string>,
  exists: (id: string | null) =>
    `Ein Skill namens „${id ?? "dies"}“ ist bereits vorhanden und wird nicht überschrieben. Alten entfernen oder Ordner umbenennen und erneut hinzufügen.`,
  invalid: (issue: string) => `Kein nutzbarer Skill: ${issue}. Stammordner benötigt SKILL.md mit name und description am Anfang.`,
  tooLarge: (files: number, total: string, skillFile: string) =>
    `Skill zu groß: höchstens ${files} Dateien mit insgesamt ${total}; SKILL.md selbst höchstens ${skillFile}.`,
  githubNotFound: "Repository, Branch oder Ordner auf GitHub nicht gefunden (möglicherweise privat). Adresse prüfen.",
  folderNotFound: "Ordner nicht gefunden; möglicherweise verschoben oder gelöscht.",
  urlInvalid: "Adresse nicht erkannt. owner/repo oder https://github.com/owner/repo/tree/branch/folder verwenden.",
  network: "GitHub nicht erreichbar. Netzwerk prüfen und erneut versuchen.",
  rateLimited: "Anonymes GitHub-Zugriffslimit erreicht. Später erneut importieren.",
  offline: "Strikter Offlinemodus aktiv; kein GitHub-Import.",
  builtinNotRemovable: "Integrierte Skills sind nicht entfernbar, aber abschaltbar.",
  notFound: "Skill nicht mehr vorhanden; möglicherweise gerade entfernt.",
  fileNotFound: "Datei nicht mehr vorhanden.",
  fileTooLarge: "Datei zu groß für Anzeige; im Ordner öffnen.",
  fileNotText: "Keine Textdatei; hier nicht angezeigt.",
  webNotAllowed: "Im Browser nicht möglich; BaoCut-Desktop-App verwenden.",
  webReadOnly: "Diese Browsersitzung ist schreibgeschützt; keine Änderungen möglich.",
  failed: (action: string, raw: string) => `Fehlgeschlagen: ${action}: ${raw}`,
  sendFailed: (raw: string) => `Senden fehlgeschlagen: ${raw}`,
};
