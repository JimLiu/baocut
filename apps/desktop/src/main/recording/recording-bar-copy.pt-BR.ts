import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const ptBR: RecordingBarMessages = {
  launcherTitle: 'Gravar',
  pickerTitle: 'Escolha o que gravar',
  barTitle: 'Controles de gravação',
  cameraTitle: 'Prévia da câmera',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Parar gravação · ${elapsed}`,
  trayFinishing: 'Finalizando…',
  trayOpen: 'Abrir o BaoCut',
  trayDisplay: 'Gravar tela',
  trayWindow: 'Gravar janela',
  trayArea: 'Gravar área',
  traySettings: 'Configurações…',
  trayQuit: 'Sair do BaoCut',
};
