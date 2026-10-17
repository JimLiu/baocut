import type { PetMessages } from './pet-copy.ts';

export const ptBR: PetMessages = {
  title: 'Codex Pets',
  note: 'Folhas de sprites de 8 colunas · loop em repouso · segue o cursor de reprodução',
  peekNote: (count) => `${count} da comunidade`,
  categoryChips: 'Categorias de pets',
  chip: (label, count) => `${label} ${count}`,
  categories: {
    'game-characters': 'Personagens de games',
    'anime-characters': 'Personagens de anime',
    animals: 'Animais',
    'original-characters': 'Personagens originais',
    mascots: 'Mascotes',
    others: 'Outros',
    memes: 'Memes',
    'fantasy-creatures': 'Criaturas fantásticas',
    'human-avatars': 'Avatares humanos',
    robots: 'Robôs',
    'objects-props': 'Objetos e acessórios',
  },
  noMatch: 'Nenhum pet corresponde',
  noMatchHint: 'Tente outra palavra ou outra categoria',
  nonCommercial: 'Somente uso não comercial',
  communityNote:
    'Os pets da comunidade vêm do awesome-codex-pet e são usados sob a licença indicada por cada autor (a maioria CC BY-NC 4.0; em laranja, somente uso não comercial). O crédito fica salvo com o recurso. Miniaturas e folhas de sprites são baixadas quando necessário e guardadas neste computador.',
  hint: 'Um Codex Pet é o formato de pet de área de trabalho do Codex: uma folha de sprites WebP com células de 192×208 em 8 colunas (9 linhas na v1, 11 na v2), um estado por linha. No canvas, ele toca a linha de repouso em loop, seguindo o cursor de reprodução. A folha é baixada na primeira vez que você usa o pet e fica guardada neste computador.',
  addFailed: (message) => `Não foi possível adicionar o pet: ${message}`,
};
