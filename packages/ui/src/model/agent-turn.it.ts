import type { AgentTurnMessages } from './agent-turn.ts';

export const it: AgentTurnMessages = {
  waiting: "In attesa della tua approvazione",
  working: "In corso",
  stopping: "Interruzione in corso",
  worked: (span: string) => `Ha lavorato per ${span}`,
  stoppedAfter: (span: string) => `Interrotto · ha lavorato per ${span}`,
  stopped: "Interrotto",
  failed: (error: string | null) => `Non riuscito · ${error ?? "motivo sconosciuto"}`,
  stepStatus: { declined: "Rifiutato", interrupted: "Interrotto" },
  exitCode: (code: number) => `Codice di uscita ${code}`,
  stepDeclined: "Questo passaggio è stato rifiutato",
  commandExited: (code: number) => `Il comando è terminato con il codice ${code}`,
  stepIncomplete: "Questo passaggio non è stato completato",
  lineRange: (path: string, line: number, end: number) => `${path} · righe ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · riga ${line}, colonna ${col}`,
  line: (path: string, line: number) => `${path} · riga ${line}`,
};
