import type { RenderMessages } from './render-copy.ts';

export const nl: RenderMessages = {
  confetti: {
    shapes: {
      rect: "Papier",
      strip: "Strook",
      circle: "Stip",
      ellipse: "Ellips",
      triangle: "Driehoek",
      diamond: "Ruit",
      star: "Ster",
      starlet: "Vierpuntige ster",
      sparkle: "Schittering",
      heart: "Hart",
      petal: "Bloemblaadje",
      ribbon: "Lint",
    },
    styles: {
      'rainbow-paper': "Regenboogpapier",
      'pastel-fall': "Pastelregen",
      'neon-streamers': "Neonslingers",
      'golden-starburst': "Gouden sterrenregen",
      'festival-fireworks': "Feestvuurwerk",
      'hearts-petals': "Harten en bloemblaadjes",
      'party-cannons': "Confettikanonnen",
      'curling-ribbons': "Krullende linten",
      'geometric-pop': "Geometrische knal",
      'champagne-sparkle': "Champagneschittering",
    } as Record<string, string>,
  },
  fonts: {
    tableFailed: (status: number) => `Kan de lettertypetabel niet ophalen: ${status}`,
    tableLength: (expected: number, got: number) => `Lettertypetabel heeft de verkeerde lengte: verwacht ${expected} bytes, ontvangen ${got}`,
    localMissing: (family: string) => `Het lokale lettertype ${family} is verdwenen`,
    notFound: (name: string) => `Lettertype ${name} niet gevonden. Voer eerst npm run build:wasm uit`,
    unreadable: (name: string, status: number) => `Kan het lettertype niet lezen: ${name} (${status})`,
    unreadableUrl: (url: string) => `Kan het lettertype niet lezen: ${url}`,
  },
  planner: {
    wasmMissing: "De voorbeeld-WASM is niet beschikbaar. Voer eerst npm run build:wasm uit",
    reloading: "De frameplanner wordt opnieuw geladen",
    crashed: (message: string) => `De frameplanner heeft een fout aangetroffen en wordt opnieuw geladen: ${message}`,
    reloadFailed: "Kan de frameplanner niet opnieuw laden",
  },
};
