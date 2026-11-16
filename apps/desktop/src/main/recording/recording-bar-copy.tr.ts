import type { RecordingBarMessages } from './recording-bar-copy.ts';

export const tr: RecordingBarMessages = {
  launcherTitle: 'Kaydet',
  pickerTitle: 'Neyin kaydedileceğini seçin',
  barTitle: 'Kayıt denetimleri',
  cameraTitle: 'Kamera önizlemesi',
  trayTip: 'BaoCut',
  trayStopTip: (elapsed) => `Kaydı durdur · ${elapsed}`,
  trayFinishing: 'Tamamlanıyor…',
  trayOpen: "BaoCut'ı aç",
  trayDisplay: 'Ekranı kaydet',
  trayWindow: 'Pencereyi kaydet',
  trayArea: 'Alanı kaydet',
  traySettings: 'Ayarlar…',
  trayQuit: "BaoCut'tan çık",
};
