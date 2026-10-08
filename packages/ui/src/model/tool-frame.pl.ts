import type { ToolFrameMessages } from './tool-frame.ts';

export const pl: ToolFrameMessages = {
  noneAvailable: (noun) => `Brak jeszcze zasobu: ${noun}; skonfiguruj go w sekcji „Ustawienia”`,
  pickOne: (noun) => `Najpierw wybierz: ${noun}`,
  notInstalled: (name) => `${name} nie jest jeszcze zainstalowany`,
  notConnected: (provider) => `${provider} nie jest jeszcze połączony`,
  unavailable: (name, why) => `${name} · ${why ?? "Niedostępne"}`,
  notInstalledWarning: (name) => `${name} nie jest jeszcze zainstalowany. Wybierz zainstalowany lub pobierz go w sekcji „Ustawienia”`,
  notConnectedWarning: (provider) => `${provider} nie jest jeszcze połączony. Wybierz działający lub połącz go w sekcji „Ustawienia”`,
  noModel: (noun, local) => local
      ? `Brak jeszcze zasobu: ${noun}. Zainstaluj model lokalny lub połącz usługę w chmurze w sekcji „Ustawienia”.`
      : `Brak jeszcze zasobu: ${noun}. Połącz usługę w chmurze w sekcji „Ustawienia”.`,
};
