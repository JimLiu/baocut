import type { ChatMessages } from './chat-copy.ts';

export const ptBR: ChatMessages = {
  help: `Uso:
  baocut chat <message> [options]  Enviar uma mensagem e mostrar a resposta
    --project <dir>                Conversar nesta pasta de projeto (identificado por .bcut/project.json
                                   na pasta, criado se estiver ausente)
    --conversation <id>            Continuar uma sessão existente
    --template <id>                Anexar um template de cena (uma cena de baocut templates): o Runtime acrescenta
                                   o guia do briefing e o corpo do template à mensagem; exemplos não podem ser anexados;
                                   envie o prompt do exemplo (baocut templates show <id>) como mensagem
    --skill <id>                   Escolher uma skill (de baocut skills, mesmo desativada):
                                   o Runtime acrescenta o corpo do SKILL.md à mensagem
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   Alterar o modo de acesso desta sessão (vale para ações posteriores); se omitido, mantém
                                   o modo ou usa agent.defaultAccessMode (padrão auto) se o modo nunca foi alterado
    --yes                          Aprovar solicitações de aprovação automaticamente (somente nesta sessão)`,
  missingMessage: 'Texto da mensagem ausente',
  templateIsExample: (title: string, id: string) => `“${title}” é um exemplo e não pode ser anexado: obtenha o prompt com baocut templates show ${id} e envie como mensagem`,
  sessionCreated: (id: string, cwd: string) => `Sessão ${id}  pasta de trabalho ${cwd}`,
  disconnected: (reason: string) => `Conexão com o Runtime perdida: ${reason}`, sessionDeleted: 'A sessão foi excluída', stopping: 'Parando…',
  chatTemplate: (id: string) => `Template: ${id}`, chatSkill: (id: string) => `Skill: ${id}`, chatMode: (mode: string) => `Modo de acesso: ${mode}`,
  taskEnded: (status: string, error: string | null) => `Tarefa: ${status}${error ? ` — ${error}` : ''}`,
  taskStatus: { completed: 'Concluído', stopped: 'Parado', failed: 'Falhou' }, taskFailed: 'A tarefa falhou',
  toolCallFinished: (title: string, status: string, exitCode: number | null) => `▸ ${title} — ${status}${exitCode !== null ? ` (código de saída ${exitCode})` : ''}`,
  approvalNeeded: (what: string) => `Aprovação necessária — ${what}`, approvalReason: (isTool: boolean, reason: string) => `${isTool ? 'Conteúdo' : 'Motivo'}: ${reason}`, approvalMode: (mode: string) => `Modo atual: ${mode}`,
  autoApproved: 'Aprovado automaticamente (--yes)', declinedNotTty: 'Não está executando em um terminal: recusado (adicione --yes para aprovar automaticamente)',
  approvalQuestion: 'Aprovar? [y] sim / [s] sessão / [N] não ',
};
