import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const ko: RecordingBarMessages = {
  launcherTitle: '녹화',
  pickerTitle: '녹화할 대상 선택',
  barTitle: '녹화 컨트롤',
  cameraTitle: '카메라 미리보기',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `녹화 중지 · ${elapsed}`,
  trayFinishing: '마무리하는 중…',
  trayOpen: 'BaoCut 열기',
  trayDisplay: '화면 녹화',
  trayWindow: '윈도우 녹화',
  trayArea: '영역 녹화',
  traySettings: '설정…',
  trayQuit: 'BaoCut 종료',
};
