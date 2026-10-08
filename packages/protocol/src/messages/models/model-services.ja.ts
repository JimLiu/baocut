import type { ModelsModelServicesMessages } from './model-services.ts';

export const ja: ModelsModelServicesMessages = {
  noSuchProvider: (p: { provider: string }) => `そのプロバイダはありません：${p.provider}`,
  noConfigureNeeded: 'このコンピュータとノードには設定は不要です。オンオフの切り替えとキーがあるのはオンラインプロバイダだけです',
  cannotRemove: '削除できるのはオンラインサービスのプロバイダだけです。このコンピュータ、ノード、Agent プロバイダは削除できません',
  noAccounts: 'アカウントがあるのはオンラインサービスのプロバイダだけです。このコンピュータ、ノード、Agent プロバイダにはありません',
  noCapabilityParameters: (p: { capability: string }) => `${p.capability} には機能パラメータがありません`,
  noRefresh: '更新できるモデル一覧があるのはオンラインプロバイダだけです',
  clearWithModel: '既定をクリアするときはモデルを指定しないでください',
  capabilityNotOffered: (p: { provider: string; capability: string }) => `${p.provider} はこの機能を提供していません：${p.capability}`,
  noSelectableModel: (p: { provider: string }) => `${p.provider} には選択できるモデルがありません。modelId を指定してください`,
  providerNoModel: (p: { provider: string; model: string }) => `${p.provider} にそのモデルはありません：${p.model}`,
  providerNodeConflict: 'provider と node が別々のプロバイダを指しています',
  modelBundleMismatch: 'model と bundleId が一致しません',
  cannotTranscribe: (p: { provider: string }) => `${p.provider} では文字起こしできません。別のサービスに切り替えてください。`,
  cannotUseCapability: (p: { provider: string }) => `${p.provider} はこの機能には使えません。別のサービスに切り替えてください。`,
  cannotGenerateText: (p: { provider: string }) => `${p.provider} はテキスト生成には使えません。別のサービスに切り替えてください。`,
};
