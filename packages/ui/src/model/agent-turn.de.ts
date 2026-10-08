import type { TimelineItem } from '@baocut/protocol';
type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;
import type { AgentTurnMessages } from './agent-turn.ts';

export const de: AgentTurnMessages = {
  waiting: "Wartet auf Ihre Genehmigung",
  working: "Verarbeitung",
  stopping: "Wird gestoppt",
  worked: (span: string) => `Bearbeitet für ${span}`,
  stoppedAfter: (span: string) => `Gestoppt · bearbeitet für ${span}`,
  stopped: "Gestoppt",
  failed: (error: string | null) => `Fehlgeschlagen · ${error ?? "unbekannter Grund"}`,
  stepStatus: { declined: "Abgelehnt", interrupted: "Unterbrochen" } as Partial<Record<ToolCall['status'], string>>,
  exitCode: (code: number) => `Exit-Code ${code}`,
  stepDeclined: "Dieser Schritt wurde abgelehnt",
  commandExited: (code: number) => `Befehl beendet mit Code ${code}`,
  stepIncomplete: "Dieser Schritt wurde nicht abgeschlossen",
  lineRange: (path: string, line: number, end: number) => `${path} · Zeilen ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · Zeile ${line}, Spalte ${col}`,
  line: (path: string, line: number) => `${path} · Zeile ${line}`,
};
