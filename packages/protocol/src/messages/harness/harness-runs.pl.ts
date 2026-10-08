import type { HarnessRunsMessages } from './harness-runs.ts';

export const pl: HarnessRunsMessages = {
  retrying: (p) => `${p.message} (ponawianie)`,
  modeChanged: (p) => `Tryb dostępu zmieniono na „${p.to}” (wcześniej „${p.from}”). Dotyczy kolejnych działań.`,
  jobsCancelled: (p) => `Zażądano anulowania nieukończonych zadań w tle tej sesji (${p.count}). Ukończone wyniki zostają zachowane.`,
  jobsCancelledGenerated: (p) => `Zażądano anulowania nieukończonych zadań w tle tej sesji (${p.count}, generowanie lub transkrypcja). Ukończone wyniki zostają zachowane.`,
  goalChangedStopped: "Cel zmieniono: poprzednie zadanie zatrzymano. Rozpoczyna się nowe zadanie dla nowego celu.",
  goalChangedKept: "Cel zmieniono: turę poprzedniego zadania zatrzymano. Wysłane zadania w tle kończą się normalnie, a wyniki pozostają propozycjami. Rozpoczyna się nowe zadanie dla nowego celu.",
  stopReplyUnconfirmed: (p) => `Zażądano zatrzymania odpowiedzi, ale nie potwierdzono zatrzymania ${p.agent}.`,
  stopUnconfirmed: (p) => `Zażądano zatrzymania, ale nie potwierdzono zatrzymania ${p.agent}.`,
  stopTimedOut: (p) => `${p.agent} nie potwierdził zatrzymania w ciągu 10 sekund, więc zakończono jego proces. Kroki bez potwierdzenia anulowania mogły już odnieść skutek.`,
  agentRemovedNotice: (p) => `Agent ${p.agent} został usunięty, więc zadanie nie zostało ukończone. Wprowadzone zmiany nie są cofane automatycznie.`,
  agentRemoved: (p) => `Agent ${p.agent} został usunięty`,
  runtimeStoppedNotice: "Zadanie trwało podczas zatrzymania Runtime, więc zostało przerwane.",
  runtimeExitedNotice: "Runtime zakończył działanie w trakcie zadania, więc zadanie nie zostało ukończone. Wprowadzone zmiany nie są cofane automatycznie.",
  runtimeExited: "Runtime zakończył działanie w trakcie zadania",
  turnFailed: "Tura nie powiodła się",
  processExited: (p) => `${p.agent} – proces zakończył się nieoczekiwanie: ${p.error}`,
  noErrorMessage: "brak komunikatu błędu",
  fileChangeSummary: "Edytuj pliki",
};
