import type { ChatMessages } from './chat-copy.ts';

export const pl: ChatMessages = {
  help: "Użycie:\n  baocut chat <message> [options]  Wyślij wiadomość i wyświetl odpowiedź\n    --project <dir>                Rozmowa w katalogu projektu (projekt identyfikuje\n                                   .bcut/project.json w katalogu, tworzony, jeśli brak)\n    --conversation <id>            Kontynuuj istniejącą sesję\n    --template <id>                Załącz szablon sceny (scena z baocut templates): Runtime dodaje\n                                   przewodnik i treść szablonu do wiadomości; nie można załączać przykładów;\n                                   wyślij prompt przykładu (baocut templates show <id>) jako wiadomość\n    --skill <id>                   Wybierz Skill (z baocut skills, nawet wyłączony):\n                                   Runtime dodaje treść SKILL.md do wiadomości\n    --mode <ask|auto-accept-edits|auto|full-access|plan>\n                                   Zmień tryb dostępu sesji (dla późniejszych działań); bez parametru tryb zostaje zachowany,\n                                   lub używa agent.defaultAccessMode (domyślnie auto), jeśli trybu nigdy nie zmieniano\n    --yes                          Automatycznie zatwierdzaj żądania (tylko ta sesja)",
  missingMessage: "Brak tekstu wiadomości",
  templateIsExample: (title, id) => `„${title}” to przykład i nie można go załączyć: pobierz prompt przez baocut templates show ${id} i wyślij jako wiadomość`,
  sessionCreated: (id, cwd) => `Sesja ${id}  folder roboczy ${cwd}`,
  disconnected: (reason) => `Utracono połączenie z Runtime: ${reason}`,
  sessionDeleted: "Sesja została usunięta",
  stopping: "Zatrzymywanie…",
  chatTemplate: (id) => `Szablon: ${id}`,
  chatSkill: (id) => `Skill: ${id}`,
  chatMode: (mode) => `Tryb dostępu: ${mode}`,
  taskEnded: (status, error) => `Zadanie: ${status}${error ? ` — ${error}` : ""}`,
  taskStatus: { completed: "Gotowe", stopped: "Zatrzymano", failed: "Niepowodzenie" },
  taskFailed: "Zadanie nie powiodło się",
  toolCallFinished: (title, status, exitCode) => `▸ ${title} — ${status}${exitCode !== null ? ` (kod zakończenia ${exitCode})` : ""}`,
  approvalNeeded: (what) => `Wymagane zatwierdzenie – ${what}`,
  approvalReason: (isTool, reason) => `${isTool ? "Treść" : "Powód"}: ${reason}`,
  approvalMode: (mode) => `Obecny tryb: ${mode}`,
  autoApproved: "Zatwierdzono automatycznie (--yes)",
  declinedNotTty: "Uruchomione poza terminalem: odmówiono (dodaj --yes dla automatycznego zatwierdzania)",
  approvalQuestion: "Zatwierdzić? [y] tak / [s] sesja / [N] nie ",
};
