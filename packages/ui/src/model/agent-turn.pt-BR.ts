import type { AgentTurnMessages } from './agent-turn.ts';

export const ptBR: AgentTurnMessages = {
  waiting: "Aguardando sua aprovação",
  working: "Em andamento",
  stopping: "Parando",
  worked: (span: string) => `Trabalhou por ${span}`,
  stoppedAfter: (span: string) => `Parado · trabalhou por ${span}`,
  stopped: "Parado",
  failed: (error: string | null) => `Falhou · ${error ?? "motivo desconhecido"}`,
  stepStatus: { declined: "Recusado", interrupted: "Interrompido" },
  exitCode: (code: number) => `Código de saída ${code}`,
  stepDeclined: "Esta etapa foi recusada",
  commandExited: (code: number) => `O comando terminou com o código ${code}`,
  stepIncomplete: "Esta etapa não terminou",
  lineRange: (path: string, line: number, end: number) => `${path} · linhas ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · linha ${line}, coluna ${col}`,
  line: (path: string, line: number) => `${path} · linha ${line}`,
};
