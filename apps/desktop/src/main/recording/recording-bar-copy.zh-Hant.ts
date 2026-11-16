import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const zhHant: RecordingBarMessages = {
  launcherTitle: '錄製',
  pickerTitle: '選擇要錄製的內容',
  barTitle: '錄製控制列',
  cameraTitle: '相機預覽',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `停止錄製 · ${elapsed}`,
  trayFinishing: '正在收尾…',
  trayOpen: '打開 BaoCut',
  trayDisplay: '錄製螢幕',
  trayWindow: '錄製視窗',
  trayArea: '錄製區域',
  traySettings: '設定…',
  trayQuit: '結束 BaoCut',
};
