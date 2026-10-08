import type { GrantsMessages } from './grants-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: GrantsMessages = {
  help: `Uso:
  baocut grants [list]             Listar autorizações de compartilhamento de dados (provedores on-line e de agentes):
                                   destinatário, tipos de dados, escopo, uso e orçamento
    --recipient <id>               Apenas autorizações deste provedor
    --video <video id>             Apenas autorizações que cobrem este vídeo
    --include-ended                Também listar autorizações revogadas, expiradas e esgotadas
  baocut grants create --recipient <id> --data <kind,…> --purpose <purpose> [options]
                                   Conceder uma autorização. Tipos de dados: transcript (transcrições e traduções), frames (quadros de vídeo),
                                   audio (áudio), video (vídeo original), document (texto e prompts), context (contexto do agente)
    --video <video id|all>         Cobrir apenas este vídeo; omitido ou all significa todos os vídeos
    --max-calls <n>                Limite de chamadas; sem limite se omitido
    --budget <amount> --currency <currency>
                                   Limite de gastos: estimado e reservado a partir do preço do modelo;
                                   chamadas a modelos sem preço são recusadas (BUDGET_UNVERIFIABLE)
    --expires <ISO time>           Horário de expiração
  baocut grants update <id> [--data …] [--video <id|all>] [--purpose …] [--max-calls <n|none>]
                         [--budget <amount|none> --currency …] [--expires <time|none>]
                                   Alterar uma autorização; restringi-la, reduzir um limite ou antecipar a expiração
                                   recusa as chamadas na fila sob os termos antigos quando elas começam
  baocut grants revoke <id>        Revogar uma autorização: chamadas posteriores deixam de ser permitidas; dados
                                   já enviados e custos já contabilizados são informados como estão
  baocut grants usage <id>         Uso de uma autorização e tarefas que a usaram (reservas e liquidações)`,
  usage: 'Uso: baocut grants [list [--recipient <id>] [--video <id>] [--include-ended] | create --recipient <id> --data <kind,…> --purpose <purpose> [options]' + ' | update <grant id> [options] | revoke <grant id> | usage <grant id>]', listSep: ', ', missingRecipient: 'Falta --recipient (o provedor que recebe os dados, por exemplo openai)', missingData: (kinds) => `Falta --data (tipos de dados separados por vírgulas: ${kinds.join(', ')})`, missingPurpose: 'Falta --purpose (uma frase para as pessoas lerem)', recipientFixed: 'O destinatário não pode ser alterado: revogue esta autorização e crie outra', nothingToUpdate: 'Nada a alterar: informe --data, --video, --purpose, --max-calls, --budget ou --expires', persistOnly: '--scope, --max-calls, --budget e --expires só podem ser usados com --persist', scopeChoices: '--scope aceita video ou all', unknownKinds: (unknown, kinds) => `Tipo de dado desconhecido: ${unknown}. Escolha entre ${kinds.join(', ')}`, maxCallsRange: '--max-calls deve ser um inteiro de 1 a 1000000, ou none (sem limite)', currencyNeedsBudget: '--currency só pode ser usado com --budget', budgetFormat: '--budget deve ser um valor decimal não negativo com no máximo 6 casas decimais (por exemplo 5 ou 2.50)', budgetNeedsCurrency: '--budget exige --currency <código de moeda de três letras, por exemplo USD>', expiresFormat: '--expires deve ser um horário ISO com fuso horário (por exemplo 2026-12-31T23:59:59Z), ou none',
  stateLabels: { active: 'Ativa', expired: 'Expirada', revoked: 'Revogada', exhausted: 'Esgotada' }, originLabels: { user: 'concedida por você', approval: 'concedida na aprovação', 'provider-enable': 'padrão ao ativar' }, calls: (calls, reserved, max) => `${calls}${reserved ? `+${reserved} reservadas` : ''}${max !== null ? `/${max}` : ''} ${pluralForm('pt-BR', max ?? calls + reserved, { one: 'chamada', other: 'chamadas' })}`, unknownCostCalls: (n) => ` (${n} com custo desconhecido)`, callsAndAmount: (calls, amount, reserved, cap, currency) => `${calls}, ${amount}${reserved ? `+${reserved} reservados` : ''}/${cap} ${currency}`, noGrants: 'Nenhuma autorização: chamadas a provedores on-line e de agentes pedirão aprovação (ou crie uma com baocut grants create)', scopeVideo: (videoId) => `vídeo ${videoId}`, scopeAll: 'todos os vídeos',
  grantLine: (g) => `${g.id}  [${g.state}] ${g.recipient} ← ${g.kinds}  ${g.scope}${g.taskId ? `, apenas tarefa ${g.taskId}` : ''}${g.once ? ', apenas esta vez' : ''}  uso ${g.usage}${g.expiresAt ? `, expira ${g.expiresAt}` : ''}  (${g.origin}: ${g.purpose})`, revoked: (id, recipient, kinds) => `Autorização revogada: ${id} (${recipient} ← ${kinds})`, alreadySent: (calls, amount, unknownCostCalls) => `Já enviado: ${calls} ${pluralForm('pt-BR', calls, { one: 'chamada', other: 'chamadas' })}${amount ? `, ${amount} contabilizados` : ''}${unknownCostCalls ? ` (${unknownCostCalls} com custo desconhecido)` : ''}`, runningJobs: (jobs) => `Tarefas ainda em andamento (terminarão normalmente): ${jobs.join(', ')}`, noJobs: '(Nenhuma tarefa usou esta autorização ainda, ou os registros foram limpos)', settled: (calls, amount, basis) => `liquidado ${calls} ${pluralForm('pt-BR', calls, { one: 'chamada', other: 'chamadas' })} ${amount} (${basis})`, unsettled: 'não liquidado', jobLine: (jobId, state, calls, amount, settled) => `  ${jobId}  ${state}  reservado ${calls} ${pluralForm('pt-BR', calls, { one: 'chamada', other: 'chamadas' })} ${amount}  ${settled}`,
  approvalGrant: (a) => `    Envia: ${a.recipient} ← ${a.kinds}${a.videoId ? ` (vídeo ${a.videoId})` : ''}: ${a.purpose}${a.estimate ? `, estimativa ${a.estimate}` : ', custo desconhecido'}${a.maxCalls !== null ? `, no máximo ${a.maxCalls} ${pluralForm('pt-BR', a.maxCalls, { one: 'chamada', other: 'chamadas' })}` : ''}${a.reason === 'revoked' ? ', autorização revogada ou expirada' : a.reason === 'unverifiable' ? ', não é possível estimar o custo' : ''}`,
};
