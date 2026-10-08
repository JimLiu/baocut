import type { RuntimeMessages } from './runtime-copy.ts';

export const tr: RuntimeMessages = {
  missingContext: 'RuntimeContext eksik',
  mediaStatus: (status) => `Medya hizmeti ${status} döndürdü`,
  noRootSequence: 'Yeni videoda ana sekans yok',
  edit: {
    importAssets: 'Medya içe aktar',
    setBackground: 'Arka planı ayarla',
    addWaveform: 'Dalga formu ekle',
  },
  waveformName: 'Dalga formu',
  noDuration: 'Videonun henüz süresi yok, bu yüzden dalga formu eklenmedi',
  noOpenVideo: 'Açık video yok',
  notCaughtUp: 'Video henüz eşitlenmedi ve şu anda değiştirilemiyor',
};
