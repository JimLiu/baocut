import type { FullscreenPlayerMessages } from './fullscreen-player-copy.ts';

export const ptBR: FullscreenPlayerMessages = {
  region: 'Player em tela cheia',
  enter: 'Reproduzir em tela cheia',
  enterTip: 'Reproduzir em tela cheia (F)',
  captions: 'Legendas',
  captionsTip: (mode: string) => `Legendas: ${mode} (C)`,
  captionMode: { off: 'Legendas desativadas', source: 'Original', trans: 'Tradução', both: 'Bilíngue' },
  keysTip: 'Atalhos de teclado (?)',
  keysTitle: 'Atalhos de teclado',
  keysFooter: 'Pressione Esc para fechar esta lista e de novo para sair da tela cheia.',
  keys: {
    play: 'Reproduzir / pausar (igual a um clique sobre a imagem)',
    exit: 'Sair da tela cheia (igual a um clique duplo sobre a imagem)',
    back: 'Voltar / avançar 5 segundos',
    back10: 'Voltar / avançar 10 segundos',
    prevChapter: 'Capítulo anterior / próximo',
    volUp: 'Volume ±10 (tira o mudo automaticamente)',
    mute: 'Silenciar / ativar o som',
    captions: 'Alternar o modo de legendas',
    start: 'Ir para o início / o fim',
    percent: 'Ir para 0% – 90% do vídeo',
    keys: 'Esta lista',
  },
};
