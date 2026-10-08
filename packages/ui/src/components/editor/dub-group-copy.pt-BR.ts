import type { DubGroupMessages } from './dub-group-copy.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: DubGroupMessages = {
  track: 'Mostrar esta faixa na linha do tempo',
  trackGone: 'Este grupo de dublagem não está mais na linha do tempo',
  regen: (n: number) => pluralForm('pt-BR', n, { one: `Gerar ${n} frase novamente…`, other: `Gerar ${n} frases novamente…` }),
  regenNote: 'Frases não sintetizadas ou que não cabem · revise, altere a tradução se necessário e refaça somente estas',
  download: 'Baixar grupo',
  downloadNote: 'Ainda não é possível baixar grupos inteiros; para obter a mixagem deste grupo, escolha “Somente este grupo de dublagem” ao exportar áudio',
  redub: 'Refazer este idioma',
  redubNote: 'Abre Dublagem traduzida',
  remove: 'Remover este grupo de dublagem',
  removeNote: 'Remove os clipes deste grupo da linha do tempo e restaura o áudio original; você pode desfazer. A faixa de dublagem vazia e o plano são mantidos',
  removeLoading: 'Carregando plano de dublagem…',
  readOnly: 'O vídeo é somente leitura',
  removed: (title: string) => `Removido: “${title}”`,
  rowOnTimeline: (label: string) => `Linha “${label}” na linha do tempo`,
  undo: 'Desfazer',
  stateOn: 'Na linha do tempo', stateOff: 'Faixa desativada', stateGone: 'Fora da linha do tempo',
  groupMenu: 'Este grupo de dublagem',
  actionsOf: (title: string) => `Ações de “${title}”`,
  clickToSelect: (text: string) => `${text} · clique para selecionar na linha do tempo`,
};
