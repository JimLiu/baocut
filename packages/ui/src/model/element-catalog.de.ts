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

export const de: ElementCatalogMessages = {
  stickers: {
    badge_check: "Häkchen-Abzeichen",
    badge_cross: "Kreuz-Abzeichen",
    star_burst: "Sternenexplosion",
    speech_bubble: "Sprechblase",
    heart: "Herz",
    bolt: "Blitz",
    pin: "Reißzwecke",
    sparkle: "Glitzern",
    arrow_curved: "Gebogener Pfeil",
    crown: "Krone",
  } as Record<string, string>,
  shapes: {
    rect: "Rechteck",
    ellipse: "Ellipse",
    triangle: "Dreieck",
    rombus: "Rhombus",
    pentagon: "Fünfeck",
    hex: "Sechseck",
    octagon: "Achteck",
    squig: "Wellenkreis",
    squig2: "Blockpfeil",
    tick: "Häkchen",
    tick2: "Kreuz",
    chevron: "Winkel",
    chevron2: "Zickzackband",
    cross2: "Abgerundetes Plus",
    cross: "Plus",
    love2: "Abgerundetes Herz",
    love: "Herz",
    diamond: "Edelstein",
    star: "Fünfzackiger Stern",
    sharp: "Zehnzackiger Stern",
    star2: "Zwölfzackiger Stern",
    sharp2: "Sprechblase",
  } as Record<string, string>,
  progress: {
    normal: "Eckiger Balken",
    rounded: "Abgerundeter Balken",
    circle: "Ring",
    donut: "Donut",
    border: "Rand",
    reverse_border: "Umgekehrter Rand",
    rainbow_border: "Regenbogenrand",
    reverse_rainbow_border: "Umgekehrter Regenbogenrand",
    strobe_border: "Stroboskoprand",
    reverse_strobe_border: "Umgekehrter Stroboskoprand",
    snake: "Schlange",
    snake_spin: "Drehende Schlange",
    snake_rainbow: "Regenbogenschlange",
    snake_spin_rainbow: "Drehende Regenbogenschlange",
  } as Record<string, string>,
  waves: {
    bars: "Balken",
    bars_rounded: "Abgerundete Balken",
    bars_bottom: "Unten ausgerichtete Balken",
    ring_bars: "Ringbalken",
    oscilloscope: "Oszilloskop",
    ring_wave: "Ringwelle",
    spectrum_area: "Spektralfläche",
    dots: "Punktmatrix",
    pulse_rings: "Pulsringe",
    ribbons: "Bänder",
  } as Record<string, string>,
  colors: {
    bar: "Balken",
    track: "Spur",
    background: "Hintergrund",
    color1: "Farbe 1",
    color2: "Farbe 2",
    foreground: "Vordergrund",
    bars: "Balken",
    waveform: "Wellenform",
    fill: "Füllung",
    line: "Zeilenhöhe",
    dots: "Punkte",
    peak: "Spitze",
    core: "Kern",
    rings: "Ringe",
    ribbonA: "Band A",
    ribbonB: "Band B",
  } as Record<ColorSlot, string>,
  roundedRect: "Abgerundetes Rechteck",
  countdown: "Countdown",
  countup: "Aufwärts zählen",
  progressName: (label: string) => `Fortschrittsbalken · ${label}`,
  waveName: (label: string) => `Wellenform · ${label}`,
  confettiName: (label: string) => `Konfetti · ${label}`,
  shapeName: (name: string) => `Form · ${name}`,
  stickerName: (label: string) => `Sticker · ${label}`,
  sections: {
    sticker: { title: "Sticker", note: "10 integrierte + Markenbibliothek" },
    dynamic: {
      title: "Animierte Sticker",
      note: "10 Konfettistile + Lottie aus Markenbibliothek",
    },
    shape: { title: "Formen", note: "23 Kacheln · 5-Farben-Zyklus" },
    visualizer: {
      title: "Visualisierungen",
      note: "14 Fortschrittsstile + 2 Timer + 10 Wellenformen",
    },
  } as Record<ElementSection['key'], { title: string; note: string }>,
};
