import type { HarnessAgentsMessages } from './harness-agents.ts';
import { pluralForm } from '../../i18n.ts';

export const ptBR: HarnessAgentsMessages = {
  listSeparator: ', ', noDriver: (p) => `Nenhum agente registrado com id ${p.id}`, probeFailed: (p) => `Falha na detecção: ${p.error}`,
  cannotChangeAgent: 'Esta sessão já iniciou, então seu agente não pode ser alterado. Inicie uma nova sessão para escolher outro.',
  noBudgetLedger: 'Este Runtime não tem registro de orçamento das tarefas, então não é possível definir orçamentos',
  driverGone: (p) => `O agente ${p.id} foi removido ou não está registrado, então esta sessão não pode mais enviar mensagens. Inicie uma nova sessão com outro agente.`,
  driverUnverified: (p) => `${p.agent} ainda não passou nos testes de integração do BaoCut. Só são mostrados os resultados da detecção, e não é possível iniciar sessões.`,
  fullAccessOnly: (p) => `${p.agent} não pode pedir aprovação passo a passo, então só executa no modo “${p.fullAccess}” (atualmente “${p.current}”). Mude para “${p.fullAccess}” e envie novamente ou use outro agente.`,
  runtimeStopping: 'O Runtime está parando', sessionBusy: 'Uma tarefa ainda está em andamento nesta sessão. Pare ou espere terminar.', sessionBusyOther: 'Esta sessão está executando outra tarefa. Pare ou espere terminar.', oldTaskNotStopped: 'A tarefa anterior ainda não parou. Tente novamente mais tarde',
  attachmentsUnsupported: 'Esta versão ainda não pode enviar imagens anexadas', attachmentDuplicate: 'Cada anexo só pode ser incluído uma vez por mensagem',
  tooManyImages: (p) => pluralForm('pt-BR', p.max, { one: `Uma mensagem pode incluir no máximo ${p.max} imagem`, other: `Uma mensagem pode incluir no máximo ${p.max} imagens` }),
  imagesUnsupported: 'Este agente não oferece suporte a imagens',
  contractRevisionMissing: (p) => `O contrato da tarefa não tem a revisão ${p.revision} (a mais recente é ${p.latest})`,
  taskEnded: 'A tarefa terminou (ou está parando), então seu contrato não pode ser alterado. Para mudar o objetivo, use tasks.changeGoal',
  contractRevisionStale: (p) => `O contrato já está na revisão ${p.latest}, não ${p.expected}. Leia novamente antes de alterar`,
  checkMissing: (p) => `O contrato da tarefa não tem esta verificação: ${p.id}`, taskNotFound: (p) => `Tarefa não encontrada: ${p.id}`, approvalNotFound: (p) => `Aprovação não encontrada: ${p.id}`,
  builtinId: (p) => `${p.id} é um id de agente integrado. Escolha outro`, agentExists: (p) => `Já existe um agente com id ${p.id}`,
  builtinNotRemovable: (p) => `O agente integrado ${p.agent} não pode ser removido. Você pode desativar nas Configurações`, agentMissing: (p) => `Nenhum agente tem id ${p.id}`, providersUnsupported: 'Este Runtime não pode adicionar ou remover agentes',
  modelMissing: (p) => `${p.agent} não tem o modelo “${p.model}”. Escolha entre ${p.choices}`,
  effortMissing: (p) => `O modelo “${p.model}” não tem esforço de raciocínio “${p.effort}”. Escolha entre ${p.choices}`,
  effortUnsupported: (p) => `O modelo “${p.model}” não tem níveis de esforço de raciocínio`,
  approvalNoGrant: 'Esta aprovação não envia dados, então não pode incluir uma escolha de autorização',
  contractFieldsReadonly: (p) => `O agente não pode alterar estes campos do contrato da tarefa: ${p.fields}. Somente o usuário decide modo de acesso, escopo das permissões, orçamento e intervalos protegidos`,
};
