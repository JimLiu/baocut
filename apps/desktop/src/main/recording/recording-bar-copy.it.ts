import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const it: RecordingBarMessages = {
  launcherTitle: 'Registra',
  pickerTitle: 'Scegli cosa registrare',
  barTitle: 'Controlli di registrazione',
  cameraTitle: 'Anteprima della fotocamera',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Interrompi registrazione · ${elapsed}`,
  trayFinishing: 'Completamento…',
  trayOpen: 'Apri BaoCut',
  trayDisplay: 'Registra schermo',
  trayWindow: 'Registra finestra',
  trayArea: 'Registra area',
  traySettings: 'Impostazioni…',
  trayQuit: 'Esci da BaoCut',
};
