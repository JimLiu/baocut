import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const es: RecordingBarMessages = {
  launcherTitle: 'Grabar',
  pickerTitle: 'Elige qué grabar',
  barTitle: 'Controles de grabación',
  cameraTitle: 'Vista previa de la cámara',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Detener grabación · ${elapsed}`,
  trayFinishing: 'Terminando…',
  trayOpen: 'Abrir BaoCut',
  trayDisplay: 'Grabar pantalla',
  trayWindow: 'Grabar ventana',
  trayArea: 'Grabar área',
  traySettings: 'Ajustes…',
  trayQuit: 'Salir de BaoCut',
};
