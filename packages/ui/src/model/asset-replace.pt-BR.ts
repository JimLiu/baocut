import type { AssetReplaceMessages } from './asset-replace.ts';
import { pluralForm } from '@baocut/protocol';

export const ptBR: AssetReplaceMessages = {
  cantReplaceKind: 'Este tipo de mídia ainda não pode ser substituído.',
  sameKind: (kind) => `Só é possível substituir por uma mídia do mesmo tipo: aqui é necessária uma mídia de ${{ video: 'vídeo', image: 'imagem', audio: 'áudio' }[kind]}.`,
  sameAsset: 'Esta é a mídia atual. Escolha outra.',
  unused: 'Esta mídia não é usada na linha do tempo, então não há o que substituir.',
  tooShort: 'A nova mídia é curta demais para preencher um quadro.',
  allLocked: 'Todos os clipes que a usam estão bloqueados (ou são substitutos pré-renderizados de uma composição). Desbloqueie primeiro.',
  clipLocked: 'Este clipe está bloqueado. Desbloqueie primeiro.',
  durationUnknown: 'A duração da mídia é desconhecida, então os clipes mantêm a duração atual por enquanto.',
  longEnoughMany: 'A nova mídia é longa o suficiente. Nenhum destes clipes muda de duração, e a linha do tempo permanece igual.',
  longEnoughOne: 'A nova mídia é longa o suficiente. O clipe mantém sua duração, e a linha do tempo permanece igual.',
  shortenMany: (n: number, seconds: string) => `${pluralForm('pt-BR', n, { one: `${n} clipe fica mais curto`, other: `${n} clipes ficam mais curtos` })}, ${seconds} s no total`,
  shortenOne: (seconds: string) => `O clipe fica ${seconds} s mais curto`,
  moved: (head: string, n: number) => `${head}, e ${pluralForm('pt-BR', n, { one: `o próximo ${n} clipe da faixa se move para antes`, other: `os próximos ${n} clipes da faixa se movem para antes` })}.`,
  trackShorter: (head: string) => `${head}, e a faixa fica mais curta.`,
  transitions: (n: number) => n === 1 ? 'A transição destes clipes será removida.' : pluralForm('pt-BR', n, { other: `As ${n} transições destes clipes serão removidas.` }),
  captions: (n: number) => pluralForm('pt-BR', n, { one: `${n} legenda tem seu tempo baseado nestes clipes e precisará ser realinhada após a substituição.`, other: `${n} legendas têm seus tempos baseados nestes clipes e precisarão ser realinhadas após a substituição.` }),
  ducking: (n: number) => pluralForm('pt-BR', n, { one: `${n} regra de redução de volume aponta para estes clipes e não corresponderá após a substituição.`, other: `${n} regras de redução de volume apontam para estes clipes e não corresponderão após a substituição.` }),
};
