import type { TimelineItem } from '@baocut/protocol';
type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;
import type { AgentTurnMessages } from './agent-turn.ts';

export const fr: AgentTurnMessages = {
  waiting: "Attente de votre approbation",
  working: "En cours",
  stopping: "Arrêt",
  worked: (span: string) => `Travail pendant ${span}`,
  stoppedAfter: (span: string) => `Arrêté · travail pendant ${span}`,
  stopped: "Arrêté",
  failed: (error: string | null) => `Échec · ${error ?? "motif inconnu"}`,
  stepStatus: { declined: "Refusé", interrupted: "Interrompu" } as Partial<Record<ToolCall['status'], string>>,
  exitCode: (code: number) => `Code de sortie ${code}`,
  stepDeclined: "Étape refusée",
  commandExited: (code: number) => `Commande terminée avec code ${code}`,
  stepIncomplete: "Étape inachevée",
  lineRange: (path: string, line: number, end: number) => `${path} · lignes ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · ligne ${line}, colonne ${col}`,
  line: (path: string, line: number) => `${path} · ligne ${line}`,
};
