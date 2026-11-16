import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const pl: RecordingBarMessages = {
  launcherTitle: 'Nagrywanie',
  pickerTitle: 'Wybierz, co nagrać',
  barTitle: 'Sterowanie nagrywaniem',
  cameraTitle: 'Podgląd kamery',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Zatrzymaj nagrywanie · ${elapsed}`,
  trayFinishing: 'Kończenie…',
  trayOpen: 'Otwórz BaoCut',
  trayDisplay: 'Nagraj ekran',
  trayWindow: 'Nagraj okno',
  trayArea: 'Nagraj obszar',
  traySettings: 'Ustawienia…',
  trayQuit: 'Zakończ BaoCut',
};
