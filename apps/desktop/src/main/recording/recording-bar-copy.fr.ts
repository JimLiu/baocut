import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const fr: RecordingBarMessages = {
  launcherTitle: 'Enregistrer',
  pickerTitle: 'Choisissez quoi enregistrer',
  barTitle: 'Commandes d’enregistrement',
  cameraTitle: 'Aperçu de la caméra',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Arrêter l’enregistrement · ${elapsed}`,
  trayFinishing: 'Finalisation…',
  trayOpen: 'Ouvrir BaoCut',
  trayDisplay: 'Enregistrer l’écran',
  trayWindow: 'Enregistrer une fenêtre',
  trayArea: 'Enregistrer une zone',
  traySettings: 'Réglages…',
  trayQuit: 'Quitter BaoCut',
};
