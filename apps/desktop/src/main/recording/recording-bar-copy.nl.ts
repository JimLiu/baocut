import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const nl: RecordingBarMessages = {
  launcherTitle: 'Opnemen',
  pickerTitle: 'Kies wat je opneemt',
  barTitle: 'Opnamebediening',
  cameraTitle: 'Cameravoorvertoning',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Opname stoppen · ${elapsed}`,
  trayFinishing: 'Bezig met afronden…',
  trayOpen: 'BaoCut openen',
  trayDisplay: 'Scherm opnemen',
  trayWindow: 'Venster opnemen',
  trayArea: 'Gebied opnemen',
  traySettings: 'Instellingen…',
  trayQuit: 'BaoCut afsluiten',
};
