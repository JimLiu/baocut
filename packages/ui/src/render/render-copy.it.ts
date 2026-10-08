import type { RenderMessages } from './render-copy.ts';

export const it: RenderMessages = {
  confetti: {
    shapes: { rect: 'Carta', strip: 'Striscia', circle: 'Punto', ellipse: 'Ellisse', triangle: 'Triangolo', diamond: 'Rombo', star: 'Stella', starlet: 'Stella a quattro punte', sparkle: 'Scintilla', heart: 'Cuore', petal: 'Petalo', ribbon: 'Nastro' },
    styles: { 'rainbow-paper': 'Carta arcobaleno', 'pastel-fall': 'Caduta pastello', 'neon-streamers': 'Stelle filanti neon', 'golden-starburst': 'Esplosione di stelle dorate', 'festival-fireworks': 'Fuochi d’artificio festivi', 'hearts-petals': 'Cuori e petali', 'party-cannons': 'Cannoni da festa', 'curling-ribbons': 'Nastri arricciati', 'geometric-pop': 'Esplosione geometrica', 'champagne-sparkle': 'Scintillio di champagne' },
  },
  fonts: {
    tableFailed: (status) => `Impossibile recuperare una tabella del font: ${status}`,
    tableLength: (expected, got) => `La tabella del font ha una lunghezza errata: previsti ${expected} B, ricevuti ${got}`,
    localMissing: (family) => `Il font locale ${family} non è più disponibile`,
    notFound: (name) => `Font ${name} non trovato. Esegui prima npm run build:wasm`,
    unreadable: (name, status) => `Impossibile leggere il font ${name} (${status})`,
    unreadableUrl: (url) => `Impossibile leggere il font: ${url}`,
  },
  planner: {
    wasmMissing: 'Il WASM dell’anteprima non è disponibile. Esegui prima npm run build:wasm',
    reloading: 'Il pianificatore dei fotogrammi si sta ricaricando',
    crashed: (message) => `Il pianificatore dei fotogrammi ha incontrato un errore e si sta ricaricando: ${message}`,
    reloadFailed: 'Il pianificatore dei fotogrammi non è riuscito a ricaricarsi',
  },
};
