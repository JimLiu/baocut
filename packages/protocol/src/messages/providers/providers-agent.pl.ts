import type { ProvidersAgentMessages } from './providers-agent.ts';

export const pl: ProvidersAgentMessages = {
  codexUpgradeHint: "Zaktualizuj Codex CLI (na przykład npm install -g @openai/codex@latest), a potem sprawdź ponownie",
  codexImageModel: "Generowanie obrazów Codex (model wybierany przez Codex i Twoje konto)",
  codexImageNotes:
    "Generowanie przez konto Codex zalogowane na tym komputerze: jeden PNG i jedno zadanie naraz, zwykle w minutę lub dwie. Nie można ustawić rozmiaru ani ziarna (takie żądania są odrzucane), a rozmiar w pikselach zależy od wyniku. Zużywa limit subskrypcji; pozostały limit jest nieznany. Włączenie oznacza zgodę na wysyłanie promptów do konta Codex.",
  imagesOnly: (p) => `${p.label} może tylko generować obrazy`,
  onePngOnly: (p) => `${p.label} generuje jeden PNG naraz i nie przyjmuje rozmiaru ani ziarna`,
  unavailable: (p) => `${p.label} jest niedostępny: ${p.message}`,
  sessionNotStarted: (p) => `${p.label} – sesja nie została uruchomiona: ${p.error}`,
  timedOut: (p) => `${p.label} nie ukończył w ciągu ${p.minutes} min i został przerwany`,
  exited: (p) => `${p.label} zakończył się nieoczekiwanie: ${p.message}`,
  notCompleted: (p) => `${p.label} nie ukończył tego generowania: ${p.reason}`,
  turnInterrupted: "tura została przerwana",
  noImage: (p) => `${p.label} nie wygenerował obrazu`,
  noImageReply: (p) => `${p.label} nie wygenerował obrazu: ${p.reply}`,
  unknownError: "Nieznany błąd",
  processExited: "Proces zakończył działanie",
  turnNotStarted: (p) => `Tura nie rozpoczęła się: ${p.error}`,
};
