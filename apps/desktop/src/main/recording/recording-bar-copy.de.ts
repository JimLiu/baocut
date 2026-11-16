import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const de: RecordingBarMessages = {
  launcherTitle: 'Aufnehmen',
  pickerTitle: 'Auswählen, was aufgenommen wird',
  barTitle: 'Aufnahmesteuerung',
  cameraTitle: 'Kameravorschau',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Aufnahme stoppen · ${elapsed}`,
  trayFinishing: 'Wird abgeschlossen …',
  trayOpen: 'BaoCut öffnen',
  trayDisplay: 'Bildschirm aufnehmen',
  trayWindow: 'Fenster aufnehmen',
  trayArea: 'Bereich aufnehmen',
  traySettings: 'Einstellungen …',
  trayQuit: 'BaoCut beenden',
};
