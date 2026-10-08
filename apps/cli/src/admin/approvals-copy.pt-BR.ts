import type { ApprovalsMessages } from './approvals-copy.ts';

export const ptBR: ApprovalsMessages = {
  help: `Uso:
  baocut approvals                 Listar aprovações pendentes de sessões e serviços externos
  baocut approvals allow <id>      Permitir uma aprovação pendente; aprovações que compartilham dados
                                   valem apenas para esta chamada por padrão (valor desconhecido)
    --persist                      Também conceder uma autorização permanente (o mesmo compartilhamento não perguntará de novo)
    --scope <video|all>            Escopo da autorização permanente: o vídeo desta chamada (padrão) ou todos os vídeos
    --max-calls <n>                Limite de chamadas da autorização permanente
    --budget <amount> --currency <currency>
                                   Limite de gastos da autorização permanente (apenas modelos com preço;
                                   chamadas cujo custo não pode ser estimado exigem aprovação a cada vez)
    --expires <ISO time>           Quando a autorização permanente expira
  baocut approvals deny <id>       Negar uma aprovação pendente`,
  persistNeedsAllow: '--persist só pode ser usado com allow', alreadyResolved: (id) => `A aprovação ${id} já foi tratada, expirou ou foi cancelada (ou não existe)`, allowed: (id) => `Aprovação permitida: ${id}`, denied: (id) => `Aprovação negada: ${id}`, unknownMode: (value, flags) => `Modo de acesso desconhecido: ${value}. --mode aceita ${flags.join(', ')}`, mode: (label, flag) => `${label} (${flag})`, usage: 'Uso: baocut approvals [list | allow <approval id> | deny <approval id>]', riskLabels: { read: 'Leitura', edit: 'Edição', command: 'Comando', high: 'Alto risco' }, none: 'Nenhuma aprovação pendente', fromSession: (title) => `Sessão “${title}”`, fromService: (serviceId, clientName) => `Serviço ${serviceId} · ${clientName}`, basisMode: (mode) => `modo ${mode}`, basisLevel: (level) => `nível ${level}`,
  approvalLine: (a) => `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary} (${a.basis}${a.secondsLeft === null ? '' : `, negada automaticamente em ${a.secondsLeft} s`})`, runCommand: (command) => `Executar comando: ${command}`, changeFiles: (files) => `Alterar arquivos: ${files.join(', ')}`, callTool: (tool, files) => `Chamar ${tool}${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
