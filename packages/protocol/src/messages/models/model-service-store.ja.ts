import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const ja: ModelsModelServiceStoreMessages = {
  notMigrated: 'バージョン 1 のキーはまだ移行されていません',
  orderMismatch: 'order には、このプロバイダの既存のアカウントをそれぞれちょうど 1 回ずつ列挙する必要があります',
  credentialNotSaved: (p: { reason: string }) => `認証情報は保存されませんでした：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} にそのアカウントはありません：${p.account}`,
  accountLinked: (p: { home: string }) => `このアカウントは ${p.home} からリンクされています。キーの変更や削除はそちらで行ってください`,
  linkSameHome: '同じ BaoCut ホームからはアカウントをリンクできません',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} はキーをシステムのキーチェーンではなくファイルに保存しています。リンクできるのはキーチェーンを使うホームだけです`,
  linkSourceEmpty: (p: { home: string }) => `${p.home} に BaoCut のモデルサービス設定が見つかりません`,
  linkNoMatch: (p: { home: string }) => `${p.home} に一致するアカウントがありません`,
  linkedHelperMissing: (p: { home: string }) => `${p.home} からリンクしたアカウントのキーを読めません。インストール済みの BaoCut アプリの資格情報ヘルパーが見つかりません`,
  linkedSourceMissing: (p: { account: string; home: string }) => `リンクしたアカウント ${p.account} は ${p.home} にもうありません`,
  linkedKeyMissing: (p: { account: string; home: string }) => `リンクしたアカウント ${p.account}（${p.home} から）のキーがシステムのキーチェーンにありません`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `リンクしたアカウント ${p.account}（${p.home} から）のキーを読めません：${p.reason}`,
};
