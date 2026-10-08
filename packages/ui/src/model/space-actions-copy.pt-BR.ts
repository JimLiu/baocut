import type { SpaceActionsMessages } from './space-actions-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: SpaceActionsMessages = {
  edit: { video: 'Abrir vídeo', 'source-video': 'Editar no vídeo de origem', 'new-video': 'Novo vídeo desta mídia', text: 'Editar texto', version: 'Salvar cópia e editar' },
  trashed: 'Restaure este item da Lixeira primeiro', editGenerating: 'Ainda gerando; você pode editar quando terminar', editMissing: 'Arquivo não encontrado; reconecte antes de editar', editFailed: 'A geração falhou; não há arquivo para editar', editPackage: 'Pacotes de vídeo (pacotes portáteis) não podem ser editados',
  editText: 'Ainda não é possível salvar uma nova versão do texto aqui; continue em uma sessão e deixe o agente alterar',
  editVersion: 'Ainda não há edição manual de imagens, áudio e templates; continue em uma sessão e deixe o agente alterar',
  newVideoOutside: 'Este arquivo não está em uma pasta de projeto ou sessão, então ainda não pode ser usado para um novo vídeo',
  packageGenerating: 'Ainda exportando; você pode abrir quando terminar', packageMissing: 'Não é possível encontrar este arquivo', packageFailed: 'A exportação falhou; não há pacote para abrir', packageOutside: 'Este pacote não está em uma pasta de projeto ou sessão, então ainda não pode ser aberto',
  continueTrashed: 'Restaure este item da Lixeira antes de trazer para uma sessão', purgeGenerating: 'A tarefa ainda está em andamento; cancele na página Tarefas primeiro', purgeNotTrashed: 'Mova para a Lixeira primeiro e depois exclua da Lixeira',
  referenceKind: { 'video-asset': 'Mídia de vídeo', job: 'Tarefa em andamento', unverified: 'Não é possível confirmar', 'user-file': 'Outros arquivos na pasta do vídeo' },
  importAllFailed: (count: number, error: string) => `Nenhum arquivo foi importado (${count} no total): ${error}`,
  importFailed: (error: string) => `Não importado: ${error}`,
  imported: (count: number) => pluralForm('pt-BR', count, { one: `${count} mídia importada`, other: `${count} mídias importadas` }),
  copiedAll: 'copiados para imports/ do projeto', copiedSome: (count: number) => pluralForm('pt-BR', count, { one: `${count} copiado para imports/ do projeto`, other: `${count} copiados para imports/ do projeto` }), notImported: (count: number) => pluralForm('pt-BR', count, { one: `${count} não importado`, other: `${count} não importados` }),
  references: (names: readonly string[], total: number) => { const quoted = names.map((name) => `“${name}”`).join(', '); return total > names.length ? `Itens do Space ${quoted} e mais ${total - names.length}` : `${pluralForm('pt-BR', total, { one: 'Item do Space', other: 'Itens do Space' })} ${quoted}`; },
  referenceOutput: 'Resultado',
};
