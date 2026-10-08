import type { RenderMessages } from './render-copy.ts';

export const ptBR: RenderMessages = {
  confetti: {
    shapes: { rect: 'Papel', strip: 'Tira', circle: 'Ponto', ellipse: 'Elipse', triangle: 'Triângulo', diamond: 'Losango', star: 'Estrela', starlet: 'Estrela de quatro pontas', sparkle: 'Brilho', heart: 'Coração', petal: 'Pétala', ribbon: 'Fita' },
    styles: { 'rainbow-paper': 'Papel arco-íris', 'pastel-fall': 'Queda pastel', 'neon-streamers': 'Fitas neon', 'golden-starburst': 'Estrelas douradas', 'festival-fireworks': 'Fogos de festa', 'hearts-petals': 'Corações e pétalas', 'party-cannons': 'Canhões de festa', 'curling-ribbons': 'Fitas enroladas', 'geometric-pop': 'Explosão geométrica', 'champagne-sparkle': 'Brilho de champanhe' },
  },
  fonts: {
    tableFailed: (status) => `Não foi possível obter uma tabela de fonte: ${status}`,
    tableLength: (expected, got) => `A tabela de fonte tem tamanho incorreto: esperado ${expected} B, recebido ${got}`,
    localMissing: (family) => `A fonte local ${family} desapareceu`,
    notFound: (name) => `Fonte ${name} não encontrada. Execute npm run build:wasm primeiro`,
    unreadable: (name, status) => `Não foi possível ler a fonte ${name} (${status})`,
    unreadableUrl: (url) => `Não foi possível ler a fonte: ${url}`,
  },
  planner: {
    wasmMissing: 'O WASM da prévia não está disponível. Execute npm run build:wasm primeiro',
    reloading: 'O planejador de quadros está recarregando',
    crashed: (message) => `O planejador de quadros encontrou um erro e está recarregando: ${message}`,
    reloadFailed: 'O planejador de quadros não pôde recarregar',
  },
};
