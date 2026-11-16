import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const ru: RecordingBarMessages = {
  launcherTitle: 'Запись',
  pickerTitle: 'Выберите, что записывать',
  barTitle: 'Управление записью',
  cameraTitle: 'Предпросмотр камеры',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Остановить запись · ${elapsed}`,
  trayFinishing: 'Завершение…',
  trayOpen: 'Открыть BaoCut',
  trayDisplay: 'Записать экран',
  trayWindow: 'Записать окно',
  trayArea: 'Записать область',
  traySettings: 'Настройки…',
  trayQuit: 'Завершить BaoCut',
};
