import type { ToolFrameMessages } from './tool-frame.ts';

export const tr: ToolFrameMessages = {
  noneAvailable: (noun) => `Henüz ${noun} yok; Ayarlar kısmında ayarlayın`,
  pickOne: (noun) => `Önce bir ${noun} seçin`,
  notInstalled: (name) => `${name} henüz yüklü değil`,
  notConnected: (provider) => `${provider} henüz bağlı değil`,
  unavailable: (name, why) => `${name} · ${why ?? 'Kullanılamıyor'}`,
  notInstalledWarning: (name) => `${name} henüz yüklü değil. Yüklü olanı seçin veya Ayarlar kısmında indirin`,
  notConnectedWarning: (provider) => `${provider} henüz bağlı değil. Çalışan birini seçin veya Ayarlar kısmında bağlayın`,
  noModel: (noun, local) => (local ? `Henüz ${noun} yok. Ayarlar kısmında yerel bir model yükleyin veya bir bulut hizmeti bağlayın.` : `Henüz ${noun} yok. Ayarlar kısmında bir bulut hizmeti bağlayın.`),
};
