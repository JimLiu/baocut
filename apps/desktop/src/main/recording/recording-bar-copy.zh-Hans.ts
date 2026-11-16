import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const zhHans: RecordingBarMessages = {
  launcherTitle: '录制',
  pickerTitle: '选择要录制的内容',
  barTitle: '录制控制条',
  cameraTitle: '摄像头预览',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `停止录制 · ${elapsed}`,
  trayFinishing: '正在收尾…',
  trayOpen: '打开 BaoCut',
  trayDisplay: '录制屏幕',
  trayWindow: '录制窗口',
  trayArea: '录制区域',
  traySettings: '设置…',
  trayQuit: '退出 BaoCut',
};
