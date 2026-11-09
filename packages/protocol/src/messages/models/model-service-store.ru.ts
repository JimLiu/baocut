import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ru: ModelsModelServiceStoreMessages = {
  notMigrated: "Ключи из версии 1 ещё не перенесены",
  orderMismatch: "order должен содержать каждый существующий аккаунт этого поставщика сервисов ровно один раз",
  credentialNotSaved: (p: { reason: string }) => `Учётные данные не сохранены: ${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} — нет такого аккаунта: ${p.account}`,
  accountLinked: (p: { home: string }) => `Этот аккаунт привязан из ${p.home}; меняйте или удаляйте его ключ там`,
  linkSameHome: 'Нельзя привязать аккаунты из той же папки BaoCut',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} хранит ключи в файле, а не в системной связке ключей; привязать можно только папку, которая использует связку ключей`,
  linkSourceEmpty: (p: { home: string }) => `В ${p.home} нет настроек сервисов моделей BaoCut`,
  linkNoMatch: (p: { home: string }) => `В ${p.home} нет подходящего аккаунта`,
  linkedHelperMissing: (p: { home: string }) => `Ключи аккаунтов, привязанных из ${p.home}, не прочитать: не найден помощник учётных данных установленного приложения BaoCut`,
  linkedSourceMissing: (p: { account: string; home: string }) => `Привязанного аккаунта ${p.account} больше нет в ${p.home}`,
  linkedKeyMissing: (p: { account: string; home: string }) => `Ключа привязанного аккаунта ${p.account} (из ${p.home}) нет в системной связке ключей`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `Не удаётся прочитать ключ привязанного аккаунта ${p.account} (из ${p.home}): ${p.reason}`,
};
