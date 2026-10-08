import type { ElementSection } from './element-catalog.ts';
type ColorSlot =
  | 'bar'
  | 'track'
  | 'background'
  | 'color1'
  | 'color2'
  | 'foreground'
  | 'bars'
  | 'waveform'
  | 'fill'
  | 'line'
  | 'dots'
  | 'peak'
  | 'core'
  | 'rings'
  | 'ribbonA'
  | 'ribbonB';
import type { ElementCatalogMessages } from './element-catalog.ts';

export const ptBR: ElementCatalogMessages = {
  stickers: {
    badge_check: "Emblema de confirmação",
    badge_cross: "Emblema de cruz",
    star_burst: "Explosão de estrela",
    speech_bubble: "Balão de fala",
    heart: "Coração",
    bolt: "Raio",
    pin: "Alfinete",
    sparkle: "Brilho",
    arrow_curved: "Seta curva",
    crown: "Coroa",
  } as Record<string, string>,
  shapes: {
    rect: "Retângulo",
    ellipse: "Elipse",
    triangle: "Triângulo",
    rombus: "Losango",
    pentagon: "Pentágono",
    hex: "Hexágono",
    octagon: "Octógono",
    squig: "Círculo ondulado",
    squig2: "Seta em bloco",
    tick: "Marca de seleção",
    tick2: "Cruz",
    chevron: "Chevron",
    chevron2: "Faixa zigue-zague",
    cross2: "Mais arredondado",
    cross: "Mais",
    love2: "Coração arredondado",
    love: "Coração",
    diamond: "Joia",
    star: "Estrela",
    sharp: "Estrela de dez pontas",
    star2: "Estrela de doze pontas",
    sharp2: "Balão de fala",
  } as Record<string, string>,
  progress: {
    normal: "Barra quadrada",
    rounded: "Barra arredondada",
    circle: "Anel",
    donut: "Rosquinha",
    border: "Moldura",
    reverse_border: "Borda reversa",
    rainbow_border: "Borda arco-íris",
    reverse_rainbow_border: "Borda arco-íris reversa",
    strobe_border: "Borda estroboscópica",
    reverse_strobe_border: "Borda estroboscópica reversa",
    snake: "Serpente",
    snake_spin: "Serpente giratória",
    snake_rainbow: "Serpente arco-íris",
    snake_spin_rainbow: "Serpente arco-íris giratória",
  } as Record<string, string>,
  waves: {
    bars: "Barras",
    bars_rounded: "Barras arredondadas",
    bars_bottom: "Barras alinhadas abaixo",
    ring_bars: "Barras em anel",
    oscilloscope: "Osciloscópio",
    ring_wave: "Onda circular",
    spectrum_area: "Área espectral",
    dots: "Matriz de pontos",
    pulse_rings: "Anéis pulsantes",
    ribbons: "Fitas",
  } as Record<string, string>,
  colors: {
    bar: "Barra",
    track: "Faixa",
    background: "faixa de fundo",
    color1: "Cor 1",
    color2: "Cor 2",
    foreground: "Primeiro plano",
    bars: "Barras",
    waveform: "Forma de onda",
    fill: "Preenchimento",
    line: "Entrelinha",
    dots: "Pontos",
    peak: "Pico",
    core: "Núcleo",
    rings: "Anéis",
    ribbonA: "Fita A",
    ribbonB: "Fita B",
  } as Record<ColorSlot, string>,
  roundedRect: "Retângulo arredondado",
  countdown: "Contagem regressiva",
  countup: "Contagem crescente",
  progressName: (label: string) => `Barra de progresso · ${label}`,
  waveName: (label: string) => `Forma de onda · ${label}`,
  confettiName: (label: string) => `Confete · ${label}`,
  shapeName: (name: string) => `Forma · ${name}`,
  stickerName: (label: string) => `Adesivo · ${label}`,
  sections: {
    sticker: { title: "Adesivo", note: "10 integrados + biblioteca de marca" },
    dynamic: {
      title: "Adesivos animados",
      note: "10 confetes + Lottie da biblioteca de marca",
    },
    shape: { title: "Formas", note: "23 formas · ciclo de 5 cores" },
    visualizer: {
      title: "Visualizadores",
      note: "14 progressos + 2 temporizadores + 10 formas de onda",
    },
  } as Record<ElementSection['key'], { title: string; note: string }>,
};
