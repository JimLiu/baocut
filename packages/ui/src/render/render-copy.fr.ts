import type { RenderMessages } from './render-copy.ts';

export const fr: RenderMessages = {
  confetti: {
    shapes: { rect: 'Papier', strip: 'Bande', circle: 'Point', ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Losange', star: 'Étoile', starlet: 'Étoile à quatre branches', sparkle: 'Étincelle', heart: 'Cœur', petal: 'Pétale', ribbon: 'Ruban' },
    styles: { 'rainbow-paper': 'Papier arc-en-ciel', 'pastel-fall': 'Pluie pastel', 'neon-streamers': 'Serpentins néon', 'golden-starburst': 'Éclat d’étoiles dorées', 'festival-fireworks': 'Feu d’artifice de fête', 'hearts-petals': 'Cœurs et pétales', 'party-cannons': 'Canons de fête', 'curling-ribbons': 'Rubans bouclés', 'geometric-pop': 'Éclat géométrique', 'champagne-sparkle': 'Étincelles de champagne' },
  },
  fonts: {
    tableFailed: (status) => `Impossible de récupérer une table de police : ${status}`,
    tableLength: (expected, got) => `La table de police n’a pas la bonne longueur : ${expected} octets attendus, ${got} reçus`,
    localMissing: (family) => `La police locale ${family} est introuvable`, notFound: (name) => `Police ${name} introuvable. Exécutez d’abord npm run build:wasm`,
    unreadable: (name, status) => `Impossible de lire la police ${name} (${status})`, unreadableUrl: (url) => `Impossible de lire la police : ${url}`,
  },
  planner: {
    wasmMissing: 'Le WASM d’aperçu est indisponible. Exécutez d’abord npm run build:wasm', reloading: 'Le planificateur d’images se recharge',
    crashed: (message) => `Le planificateur d’images a rencontré une erreur et se recharge : ${message}`, reloadFailed: 'Impossible de recharger le planificateur d’images',
  },
};
