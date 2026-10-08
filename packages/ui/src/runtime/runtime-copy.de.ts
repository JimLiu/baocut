import type { RuntimeMessages } from './runtime-copy.ts';

export const de: RuntimeMessages = {
  missingContext: "RuntimeContext fehlt",
  mediaStatus: (status: number) => `Der Mediendienst hat zurückgegeben: ${status}`,
  noRootSequence: "Das neue Video hat keine Hauptsequenz",

  edit: {
    importAssets: "Material importieren",
    setBackground: "Hintergrund festlegen",
    addWaveform: "Wellenform hinzufügen",
  },

  waveformName: "Wellenform",
  noDuration: "Das Video hat noch keine Länge; die Wellenform wurde daher nicht hinzugefügt",
  noOpenVideo: "Kein Video geöffnet",
  notCaughtUp: "Das Video ist noch nicht auf dem neuesten Stand und kann derzeit nicht geändert werden",
};
