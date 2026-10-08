import type { RenderMessages } from './render-copy.ts';

export const pl: RenderMessages = {
  confetti: {
    shapes: {
      rect: "Papier",
      strip: "Pasek",
      circle: "Kropka",
      ellipse: "Elipsa",
      triangle: "Trójkąt",
      diamond: "Romb",
      star: "Gwiazda",
      starlet: "Gwiazda czteroramienna",
      sparkle: "Iskra",
      heart: "Serce",
      petal: "Płatek",
      ribbon: "Wstążka",
    },
    styles: {
      'rainbow-paper': "Tęczowy papier",
      'pastel-fall': "Pastelowy opad",
      'neon-streamers': "Neonowe serpentyny",
      'golden-starburst': "Złoty rozbłysk",
      'festival-fireworks': "Świąteczne fajerwerki",
      'hearts-petals': "Serca i płatki",
      'party-cannons': "Imprezowe armatki",
      'curling-ribbons': "Kręcone wstążki",
      'geometric-pop': "Geometryczny wybuch",
      'champagne-sparkle': "Blask szampana",
    },
  },
  fonts: {
    tableFailed: (status) => `Nie udało się pobrać tabeli czcionki: ${status}`,
    tableLength: (expected, got) => `Nieprawidłowa długość tabeli czcionki: oczekiwano ${expected} bajtów, otrzymano ${got}`,
    localMissing: (family) => `Lokalna czcionka ${family} jest już niedostępna`,
    notFound: (name) => `Czcionka ${name} nie została znaleziona. Najpierw uruchom npm run build:wasm`,
    unreadable: (name, status) => `Nie udało się odczytać czcionki ${name} (${status})`,
    unreadableUrl: (url) => `Nie udało się odczytać czcionki: ${url}`,
  },
  planner: {
    wasmMissing: "WASM podglądu jest niedostępny. Najpierw uruchom npm run build:wasm",
    reloading: "Planer klatek jest przeładowywany",
    crashed: (message) => `Błąd planera klatek, przeładowywanie: ${message}`,
    reloadFailed: "Nie udało się przeładować planera klatek",
  },
};
