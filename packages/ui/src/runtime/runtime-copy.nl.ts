import type { RuntimeMessages } from './runtime-copy.ts';

export const nl: RuntimeMessages = {
  missingContext: "RuntimeContext ontbreekt",
  mediaStatus: (status: number) => `De mediadienst heeft geretourneerd: ${status}`,
  noRootSequence: "De nieuwe video heeft geen hoofdsequentie",

  edit: {
    importAssets: "Media importeren",
    setBackground: "Achtergrond instellen",
    addWaveform: "Golfvorm toevoegen",
  },

  waveformName: "Golfvorm",
  noDuration: "De video heeft nog geen lengte, dus de golfvorm is niet toegevoegd",
  noOpenVideo: "Er is geen video geopend",
  notCaughtUp: "De video is nog niet bijgewerkt en kan nu niet worden gewijzigd",
};
