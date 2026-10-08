import { pluralForm } from '../../i18n.ts';
import type { RcGrantsMessages } from './rc-grants.ts';

const KINDS: Readonly<Record<string, string>> = { transcript: 'transcrições e traduções', frames: 'quadros e miniaturas de vídeo', audio: 'áudio', video: 'vídeo original', document: 'texto e prompts', context: 'contexto de conversa do agente' };
function enKinds(codes: string): string { return new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(codes.split(',').filter(Boolean).map((k) => KINDS[k] ?? k)); }

export const ptBR: RcGrantsMessages = {
  dataKinds: (p: { kinds: string }) => enKinds(p.kinds),

  grantLapsed: (p) => `A autorização para enviar ${enKinds(p.kinds)} a ${p.label} ${p.expired ? 'expirou' : 'foi revogada'}`,
  grantRequired: (p: { kinds: string; label: string }) => `Enviar ${enKinds(p.kinds)} a ${p.label} exige autorização do usuário`,
  grantCallsUsedUp: (p: { used: number; max: number | null }) =>
    `O limite de chamadas da autorização (${p.used}/${p.max}) acabou; esta chamada excederia o orçamento`,
  grantAmountUsedUp: "O limite de valor da autorização acabou; esta chamada excederia o orçamento",
  budgetUnverifiable: (p: { label: string }) =>
    `A autorização tem limite de valor, mas este modelo de ${p.label} não tem preço confiável; não é possível garantir o limite`,
  taskCallsUsedUp: (p: { used: number; max: number | null }) =>
    `O orçamento de chamadas desta tarefa (${p.used}/${p.max}) acabou; esta chamada excederia o orçamento da tarefa`,
  taskAmountUsedUp: (p: { amount: string; currency: string }) =>
    `O orçamento de valor desta tarefa (${p.amount} ${p.currency}) acabou; esta chamada excederia o orçamento da tarefa`,
  taskBudgetUnverifiable: (p: { currency: string }) =>
    `O orçamento desta tarefa tem limite de valor, mas o custo não pode ser estimado em ${p.currency}; não é possível garantir o limite`,
  combined: (p: { message: string; others: number }) =>
    `${p.message} (${p.others} outros ${pluralForm('pt-BR', p.others, { one: "envio também precisa", other: "envios também precisam" })} de autorização)`,

  hintRevoked:
    "Autorizações revogadas ou expiradas não são restauradas automaticamente. Peça nova autorização nas Configurações do BaoCut, ou aprovação desta chamada na sessão.",
  hintRequired:
    "Enviar dados exige autorização por tipo, destinatário, escopo e finalidade. Peça autorização nas Configurações ou aprovação desta chamada na sessão.",
  hintExhausted:
    "Orçamento esgotado não aumenta automaticamente. Peça aumento do limite ou espere chamadas em andamento (falhas e cancelamentos liberam reservas).",
  hintUnverifiable:
    "Sem estimativa de custo, o usuário só pode aprovar cada chamada (valor desconhecido), ou autorizar por chamada com valor desconhecido.",
  hintTaskExhausted:
    "Orçamento de tarefa esgotado não aumenta automaticamente. Peça aumento no contrato ou espere chamadas em andamento (falhas e cancelamentos liberam reservas).",
  hintTaskUnverifiable:
    "Com limite de valor, só são aceitas estimativas na mesma moeda; chamadas de valor desconhecido ou outra moeda impedem a garantia. Peça remover o limite de valor (mantendo chamadas) ou usar modelo com preço.",
  hintServiceAuto:
    "O nível auto não autoriza enviar dados. Peça autorização para o provedor no BaoCut (tipos, escopo e orçamento), ou altere para ask e aprove cada chamada.",

  placeholderPurpose: "<purpose>",
  placeholderMaxCalls: "<higher call count>",
  placeholderBudget: "<higher amount>",
  placeholderCalls: "<call count>",

  grantLapsedBeforeStart: (p: { state: string }) =>
    `A autorização ${p.state === 'expired' ? "expirou" : p.state === 'revoked' ? "foi revogada" : "foi restringida"} antes da tarefa; nenhum dado enviado`,
  grantInvalidBeforeStart: "A autorização ficou inválida antes da tarefa; nenhum dado enviado",
  retrySkipped: (p: { reason: string }) => `A repetição automática não ocorreu: ${p.reason}`,
  ledgerUnsaved: "O registro de autorizações não pôde ser gravado no disco; nenhum dado enviado",
  providerDisabledBeforeStart: "O provedor foi desativado antes da tarefa; nenhum dado enviado",

  noSuchGrant: "Não existe essa autorização",
  toolPurpose: (p: { tool: string }) => `Ferramenta “${p.tool}”`,
  pipelinePurpose: (p: { label: string }) => `Fluxo “${p.label}”`,
};
