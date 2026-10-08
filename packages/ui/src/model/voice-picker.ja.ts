import type { VoicePickerMessages } from './voice-picker.ts';

export const ja: VoicePickerMessages = {
  clonedOn: (provider) => `${provider} でクローン済み · このクローンで合成`,
  defaultVoice: '既定の声',
  providerPreset: (provider, name) => `${provider} の ${name}`,
  loadingMine: 'マイボイスを読み込み中…',
  cloneNew: '新しい声をクローン…',
  cloneNewHint: '設定 › モデル › 音声合成 › マイボイスで録音するか、ファイルから読み込みます',
  myVoices: 'マイボイス',
  providerVoices: (provider) => `${provider} の声`,
  customVoice: '声の ID を入力…',
  customVoiceHint: 'プロバイダのアカウントにある声の ID',
  tempReference: '録音を一度だけ使う…',
  tempReferenceHint: 'このバージョンの合成 API は一時的な参照録音にまだ対応していません · マイボイスに保存してからクローンしてください',
  other: 'その他',
  voiceDeleted: 'この声は削除されました · 別の声を選ぶか、既定に戻してください',
  customLine: 'そのままプロバイダに渡して確認してもらいます。マイボイスでクローンした声を作って選ぶこともできます',
  presetLine: (provider, voiceId) => (voiceId === null ? `${provider} の声` : `${provider} の声 · ${voiceId}`),
  defaultLine: (provider, name) => `選ばない場合は ${provider} の既定の声（${name}）を使います`,
  noDefault: 'このモデルには既定の声がありません。先に選んでください',
};
