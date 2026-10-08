import type { ChatMessages } from './chat-copy.ts';
export const de: ChatMessages = {
 help: `Verwendung:
  baocut chat <message> [options]  Nachricht senden und Antwort ausgeben
    --project <dir>                Sitzung in diesem Projektordner (erkannt anhand von .bcut/project.json;
                                   die Datei wird angelegt, falls sie fehlt)
    --conversation <id>            Bestehende Sitzung fortsetzen
    --template <id>                Szenenvorlage anhängen (aus baocut templates): Die Runtime hängt den
                                   Briefing-Leitfaden und den Vorlageninhalt an die Nachricht an. Beispiele
                                   lassen sich nicht anhängen; senden Sie stattdessen deren Prompt
                                   (baocut templates show <id>) als Nachricht.
    --skill <id>                   Skill auswählen (aus baocut skills, auch deaktivierte):
                                   Die Runtime hängt den Inhalt von SKILL.md an die Nachricht an.
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Zugriffsmodus dieser Sitzung ändern; spätere Aktionen folgen ihm.
                                   Ohne Angabe bleibt der Modus erhalten. Wurde er nie geändert,
                                   gilt agent.defaultAccessMode (Standard: auto).
    --yes                          Genehmigungsanfragen automatisch genehmigen (nur in dieser Sitzung)`,
 missingMessage: 'Nachrichtentext fehlt', templateIsExample: (title, id) => `„${title}“ ist ein Beispiel und lässt sich nicht anhängen. Rufen Sie den Prompt mit baocut templates show ${id} ab und senden Sie ihn als Nachricht.`, sessionCreated: (id, cwd) => `Sitzung ${id}  Arbeitsordner ${cwd}`, disconnected: (reason) => `Verbindung zur Runtime unterbrochen: ${reason}`, sessionDeleted: 'Die Sitzung wurde gelöscht', stopping: 'Wird gestoppt…', chatTemplate: (id) => `Vorlage: ${id}`, chatSkill: (id) => `Skill: ${id}`, chatMode: (mode) => `Zugriffsmodus: ${mode}`, taskEnded: (status, error) => `Aufgabe: ${status}${error ? ` – ${error}` : ''}`, taskStatus: { completed: 'Fertig', stopped: 'Gestoppt', failed: 'Fehlgeschlagen' } as Readonly<Record<string, string>>, taskFailed: 'Aufgabe fehlgeschlagen', toolCallFinished: (title, status, exitCode) => `▸ ${title} – ${status}${exitCode !== null ? ` (Exit-Code ${exitCode})` : ''}`, approvalNeeded: (what) => `Genehmigung erforderlich – ${what}`, approvalReason: (isTool, reason) => `${isTool ? 'Inhalt' : 'Grund'}: ${reason}`, approvalMode: (mode) => `Aktueller Modus: ${mode}`, autoApproved: 'Automatisch genehmigt (--yes)', declinedNotTty: 'Nicht in einem Terminal ausgeführt: abgelehnt (mit --yes automatisch genehmigen)', approvalQuestion: 'Genehmigen? [y] ja / [s] Sitzung / [N] nein ',
};
