import type { ThreadMessages } from './thread-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ThreadMessages = {
  withDetail: (text, detail) => `${text} (${detail})`,
  copy: 'Copiar', copied: 'Copiado', copyFailed: 'Não foi possível copiar. Tente novamente', copyCode: 'Copiar código', copyReply: 'Copiar esta resposta',
  change: {
    added: (n) => `Adicionado: ${n}`, updated: (n) => `Alterado: ${n}`, deleted: (n) => `Excluído: ${n}`,
    duration: (clock) => `Duração ${clock}`, durationChange: (before, after) => `Duração ${before} → ${after}`, revision: (before, after) => `Versão ${before} → ${after}`,
    locked: 'O vídeo não pode ser alterado agora',
    undoStep: (videoName, label) => `Desfeita uma etapa em “${videoName}”: ${label}`,
    changed: (videoName, label) => `Alterado “${videoName}”: ${label}`, aria: (label) => `Alteração no vídeo: ${label}`,
  },
  message: {
    contextTitle: 'Estado do editor enviado com a mensagem',
    context: (videoName, revision, playhead, selected) => `“${videoName}” · Versão ${revision} · Indicador de reprodução ${playhead}${selected ? ` · ${pluralForm('pt-BR', selected, { one: `${selected} clipe selecionado`, other: `${selected} clipes selecionados` })}` : ''}`,
  },
  output: { aria: (name, detail) => `${name}, ${detail}` },
  steps: { working: (summary) => `Em andamento · ${summary}`, failed: (n) => `${n} com falha`, thinking: 'Pensando', viewFile: (name) => `Ver ${name}`, input: 'Entrada', error: 'Erro', output: 'Saída', waiting: 'Aguardando saída', noOutput: 'Sem saída' },
};
