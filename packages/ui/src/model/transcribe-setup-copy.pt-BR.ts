import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: TranscribeSetupMessages = {
  notConnected: 'Não conectado', unavailable: 'Indisponível', autoDetect: 'Detectar automaticamente',
  hintNoModel: 'Ainda não se sabe qual modelo de fala será usado. Escolha um acima para ver se aceita dicas de reconhecimento.',
  hintUnsupported: (model: string, alt: string | null) => `${model} não aceita dicas de reconhecimento, então glossários e prompt não podem ser usados nesta etapa e serão ignorados na transcrição.${alt ? ` Para usá-los na transcrição, mude para ${alt}.` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? pluralForm('pt-BR', b.custom, { one: `prompt de ${b.custom} caractere`, other: `prompt de ${b.custom} caracteres` }) : 'sem prompt';
    const dropped = b.dropped ? ` · mais ${b.dropped} não cabem; glossários listados primeiro entram primeiro` : '';
    return `Enviado a ${model}: ${custom} + ${pluralForm('pt-BR', b.terms, { one: `${b.terms} termo`, other: `${b.terms} termos` })} · cerca de ${b.chars} / ${max} caracteres${dropped}`;
  },
  glossaryGone: 'Não está mais na biblioteca de glossários · não usado desta vez',
  glossaryTranslation: 'Glossário de tradução; não usado na transcrição · não usado desta vez', anyLanguage: 'Qualquer idioma',
  termCount: (count: number) => pluralForm('pt-BR', count, { one: `${count} termo`, other: `${count} termos` }),
  noDefaultModel: 'Ainda não há modelo de fala padrão', defaultModel: (label: string) => `${label} (padrão)`, autoDetectLanguage: 'Detectar idioma automaticamente',
  glossaries: (count: number) => pluralForm('pt-BR', count, { one: `${count} glossário`, other: `${count} glossários` }),
  hasPrompt: 'Com prompt',
  noDefaultFacts: 'Ainda não há modelo de fala padrão. Escolha um ou defina um padrão na página Modelos. Se iniciar sem escolher, será informado o que falta.',
  modelUnusable: 'Este modelo não pode ser usado agora', acceptsHint: 'Aceita dicas de reconhecimento', noHint: 'Sem dicas de reconhecimento',
  followDefault: (facts: string) => `Usa o padrão · ${facts}`,
};
