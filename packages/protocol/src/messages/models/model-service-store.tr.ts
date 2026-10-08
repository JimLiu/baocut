import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const tr: ModelsModelServiceStoreMessages = {
  notMigrated: '1. sürümdeki anahtarlar henüz taşınmadı',
  orderMismatch: 'order, bu hizmet sağlayıcısının mevcut her hesabını tam bir kez listelemeli',
  credentialNotSaved: (p: { reason: string }) => `Kimlik bilgisi kaydedilmedi: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} sağlayıcısında böyle bir hesap yok: ${p.account}`,
};
