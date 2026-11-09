import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const tr: ModelsModelServiceStoreMessages = {
  notMigrated: '1. sürümdeki anahtarlar henüz taşınmadı',
  orderMismatch: 'order, bu hizmet sağlayıcısının mevcut her hesabını tam bir kez listelemeli',
  credentialNotSaved: (p: { reason: string }) => `Kimlik bilgisi kaydedilmedi: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} sağlayıcısında böyle bir hesap yok: ${p.account}`,
  accountLinked: (p: { home: string }) => `Bu hesap ${p.home} konumundan bağlandı; anahtarını orada değiştirin veya kaldırın`,
  linkSameHome: 'Aynı BaoCut klasöründen hesap bağlanamaz',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} anahtarlarını sistem anahtar zincirinde değil, bir dosyada tutuyor; yalnızca anahtar zincirini kullanan bir klasör bağlanabilir`,
  linkSourceEmpty: (p: { home: string }) => `${p.home} içinde BaoCut model hizmeti ayarı bulunamadı`,
  linkNoMatch: (p: { home: string }) => `${p.home} içinde eşleşen hesap yok`,
  linkedHelperMissing: (p: { home: string }) => `${p.home} konumundan bağlanan hesapların anahtarları okunamıyor: yüklü BaoCut uygulamasının kimlik bilgisi yardımcısı bulunamadı`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Bağlı hesap ${p.account} artık ${p.home} içinde değil`,
  linkedKeyMissing: (p: { account: string; home: string }) => `Bağlı hesap ${p.account} (${p.home} konumundan) için anahtar sistem anahtar zincirinde yok`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Bağlı hesap ${p.account} (${p.home} konumundan) için anahtar okunamıyor: ${p.reason}`,
};
