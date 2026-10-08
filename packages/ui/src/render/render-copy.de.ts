import type { RenderMessages } from './render-copy.ts';

export const de: RenderMessages = {
  confetti: {
    shapes: {
      rect: "Papier",
      strip: "Streifen",
      circle: "Punkt",
      ellipse: "Ellipse",
      triangle: "Dreieck",
      diamond: "Raute",
      star: "Stern",
      starlet: "Vierstrahliger Stern",
      sparkle: "Glitzern",
      heart: "Herz",
      petal: "Blütenblatt",
      ribbon: "Band",
    },
    styles: {
      'rainbow-paper': "Regenbogenpapier",
      'pastel-fall': "Pastellregen",
      'neon-streamers': "Neonbänder",
      'golden-starburst': "Goldener Sternenregen",
      'festival-fireworks': "Festliches Feuerwerk",
      'hearts-petals': "Herzen und Blütenblätter",
      'party-cannons': "Partykonfetti",
      'curling-ribbons': "Gewellte Bänder",
      'geometric-pop': "Geometrische Explosion",
      'champagne-sparkle': "Champagnerglitzern",
    } as Record<string, string>,
  },
  fonts: {
    tableFailed: (status: number) => `Schrifttabelle konnte nicht geladen werden: ${status}`,
    tableLength: (expected: number, got: number) => `Schrifttabelle hat die falsche Länge: erwartet ${expected} Bytes, erhalten ${got}`,
    localMissing: (family: string) => `Die lokale Schrift ${family} ist nicht mehr vorhanden`,
    notFound: (name: string) => `Schrift ${name} nicht gefunden. Zuerst npm run build:wasm ausführen`,
    unreadable: (name: string, status: number) => `Schrift konnte nicht gelesen werden: ${name} (${status})`,
    unreadableUrl: (url: string) => `Schrift konnte nicht gelesen werden: ${url}`,
  },
  planner: {
    wasmMissing: "Die Vorschau-WASM ist nicht verfügbar. Zuerst npm run build:wasm ausführen",
    reloading: "Der Frame-Planer wird neu geladen",
    crashed: (message: string) => `Der Frame-Planer hat einen Fehler festgestellt und wird neu geladen: ${message}`,
    reloadFailed: "Der Frame-Planer konnte nicht neu geladen werden",
  },
};
