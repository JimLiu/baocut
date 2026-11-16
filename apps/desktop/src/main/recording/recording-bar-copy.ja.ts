import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const ja: RecordingBarMessages = {
  launcherTitle: '収録',
  pickerTitle: '収録する対象を選択',
  barTitle: '収録コントロール',
  cameraTitle: 'カメラプレビュー',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `収録を停止 · ${elapsed}`,
  trayFinishing: '仕上げています…',
  trayOpen: 'BaoCut を開く',
  trayDisplay: '画面を収録',
  trayWindow: 'ウインドウを収録',
  trayArea: '範囲を収録',
  traySettings: '設定…',
  trayQuit: 'BaoCut を終了',
};
