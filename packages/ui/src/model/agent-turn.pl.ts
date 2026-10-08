import type { AgentTurnMessages } from './agent-turn.ts';

export const pl: AgentTurnMessages = {
  waiting: "Oczekiwanie na Twoje zatwierdzenie",
  working: "Przetwarzanie",
  stopping: "Zatrzymywanie",
  worked: (span: string) => `Praca trwała ${span}`,
  stoppedAfter: (span: string) => `Zatrzymano · praca trwała ${span}`,
  stopped: "Zatrzymano",
  failed: (error: string | null) => `Niepowodzenie · ${error ?? "nieznana przyczyna"}`,
  stepStatus: { declined: "Odmówiono", interrupted: "Przerwano" },
  exitCode: (code: number) => `Kod zakończenia ${code}`,
  stepDeclined: "Odmówiono wykonania tego kroku",
  commandExited: (code: number) => `Polecenie zakończyło działanie z kodem ${code}`,
  stepIncomplete: "Ten krok nie został ukończony",
  lineRange: (path: string, line: number, end: number) => `${path} · wiersze ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · wiersz ${line}, kolumna ${col}`,
  line: (path: string, line: number) => `${path} · wiersz ${line}`,
};
