import type { ChapterMessages } from './chapter-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: ChapterMessages = {
  band: 'Capítulos', prev: 'Capítulo anterior', next: 'Próximo capítulo', noChapters: 'Ainda não há capítulos',
  gap: 'Sem capítulo', beforeFirst: 'Antes do primeiro capítulo', add: 'Adicionar capítulo no indicador de reprodução', rename: 'Renomear…', remove: 'Excluir este capítulo',
  menuLabel: (title: string) => `Capítulo “${title}”`, gapMenuLabel: 'Barra de capítulos',
  segmentLabel: (title: string, range: string) => `${title}, ${range}, clique para ir ao início`,
  dragHint: 'Arraste para mover o início deste capítulo', addTitle: 'Adicionar capítulo', renameTitle: 'Renomear capítulo', titleLabel: 'Título',
  addAt: (time: string) => `Começa em ${time} e vai até o próximo capítulo`, confirmAdd: 'Adicionar', confirmRename: 'Renomear', cancel: 'Cancelar',
  refusal: { exists: 'Já há um capítulo no indicador de reprodução', beyond: 'O indicador de reprodução está no fim; não é possível adicionar um capítulo aqui', blank: 'O título não pode ficar vazio' },
  labels: { add: 'Adicionar capítulo', rename: 'Renomear capítulo', remove: 'Excluir capítulo', move: 'Mover início do capítulo' },
  added: (title: string) => `Capítulo adicionado: “${title}”`, renamed: (title: string) => `Renomeado para “${title}”`, removed: (title: string) => `Capítulo excluído: “${title}”`,
  undo: 'Desfazer', clickRename: 'Clique para renomear', jump: 'Ir ao início deste capítulo',
  paragraphs: (n: number) => pluralForm('pt-BR', n, { one: `${n} parágrafo`, other: `${n} parágrafos` }),
  empty: 'Este capítulo ainda não tem parágrafos',
};
