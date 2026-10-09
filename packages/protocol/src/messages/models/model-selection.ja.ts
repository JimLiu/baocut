import type { ModelsModelSelectionMessages } from './model-selection.ts';

export const ja: ModelsModelSelectionMessages = {
  capTranscribe: '文字起こし',
  capSynthesizeSpeech: '音声合成',
  capGenerateImage: '画像生成',
  capGenerateText: 'テキスト生成',
  capSeparateAudio: '音声分離',
  noSuchProvider: (p: { provider: string }) => `そのプロバイダはありません：${p.provider}`,
  noProviderForModel: (p: { model: string }) => `このモデルを提供するプロバイダはありません：${p.model}`,
  ambiguousModel: (p: { model: string }) => `複数のプロバイダにモデル ${p.model} があります。provider も指定してください`,
  languageUnsupported: (p: { modelId: string; language: string }) => `モデル ${p.modelId} は言語 ${p.language} に対応していません`,
  providerNoModel: (p: { provider: string; modelId: string }) => `${p.provider} にそのモデルはありません：${p.modelId}`,
  defaultModelGone: (p: { modelId: string; provider: string }) => `既定のモデル ${p.modelId} は ${p.provider} のモデルにもうありません`,
  missingCredential: (p: { name: string }) => `${p.name} の API キーがまだありません。設定でキーを入力してください。`,
  localNotInstalled: (p: { model: string }) =>
    `ローカルモデルバンドル ${p.model} がインストールされていません。インストールするか、別のサービスを使ってください。`,
  nodeNotPaired: (p: { name: string }) => `ノード ${p.name} はペアリングされていません。もう一度ペアリングするか、別のサービスを使ってください。`,
  nodeNotConnected: (p: { name: string }) =>
    `ノード ${p.name} に接続できません。電源が入っていて同じネットワーク上にあることを確認し、必要ならもう一度ペアリングしてください。`,
  localDisabled: (p: { model: string }) =>
    `ローカルモデルバンドル ${p.model} はエラーが繰り返されたため無効になりました。設定で再度有効にしてください。`,
  providerDisabled: (p: { name: string }) => `${p.name} は無効になっています。設定で再度有効にしてください。`,
  providerNotConfigured: (p: { name: string }) => `${p.name} はまだ設定されていません。設定で有効にしてキーを入力してください。`,
  agentNotInstalled: (p: { name: string }) => `${p.name} がインストールされていません`,
  agentNotInstalledWith: (p: { name: string; detail: string }) => `${p.name} がインストールされていません：${p.detail}`,
  agentSignedOut: (p: { name: string }) => `${p.name} にサインインしていません`,
  agentSignedOutWith: (p: { name: string; detail: string }) => `${p.name} にサインインしていません：${p.detail}`,
  agentOutdated: (p: { name: string }) => `${p.name} のバージョンが古すぎます`,
  agentOutdatedWith: (p: { name: string; detail: string }) => `${p.name} のバージョンが古すぎます：${p.detail}`,
  agentUnavailable: (p: { name: string }) => `${p.name} は現在使用できません`,
  agentUnavailableWith: (p: { name: string; detail: string }) => `${p.name} は現在使用できません：${p.detail}`,
  agentNotEnabled: (p: { name: string }) =>
    `${p.name} はまだ有効になっていません。有効にすると、プロンプト（と参照画像）をそのアカウントに送信することに同意したものとみなされ、ユーザ自身のサブスクリプションの利用枠を使います。`,
  defaultNodeUnpaired: (p: { node: string; capability: string }) =>
    `既定のノード ${p.node} はペアリングが解除されています。もう一度ペアリングするか、${p.capability} の既定を変更してください。`,
  defaultProviderRemoved: (p: { provider: string; capability: string }) =>
    `既定の ${p.provider} は削除されました。もう一度設定するか、${p.capability} の既定を変更してください。`,
  setUsableAsDefault: (p: { provider: string; capability: string }) =>
    `${p.provider} が使用できます。${p.capability} の既定に設定するだけです。`,
  noModelInstallSeparator: (p: { capability: string }) =>
    `${p.capability} に使えるモデルがまだありません。ローカルの分離モデルバンドルをインストールしてください。`,
  noModelInstallLocal: (p: { capability: string }) =>
    `${p.capability} に使えるモデルがまだありません。ローカルモデルバンドルをインストールするか、オンラインサービスを設定して既定にしてください。`,
  noModelConfigure: (p: { capability: string }) =>
    `${p.capability} に使えるモデルがまだありません。設定でサービスを構成し、既定にしてください。`,
  cannotUseFor: (p: { provider: string; capability: string }) =>
    `${p.provider} は ${p.capability} には使えません。別のサービスやモデルに切り替えるか、既定を変更してください。`,
};
