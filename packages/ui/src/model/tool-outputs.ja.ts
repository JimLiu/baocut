import type { ToolOutputsMessages } from './tool-outputs.ts';

export const ja: ToolOutputsMessages = {
  actionLabel: { 'open-movie': 'エディタで開く', 'new-movie': 'これで新しい動画を作成' },
  blockTextOnly: '文字起こしと字幕から新しい動画を作るには、動画または音声ファイルが必要です。ここからはまだ作成できません',
  blockTrashed: '先にゴミ箱からこの項目を復元してください',
  blockGenerating: 'まだ生成中です。完了すると使えます',
  blockMissing: 'この結果のファイルがこのコンピュータに見つかりません',
  handover: {
    subtitle: 'この字幕を別の言語に翻訳してください。タイムコードは変えないでください。',
    document: 'この文字起こしの要約を書いてください。',
    audio: 'この音声で動画を作ってください。',
    image: 'この画像をカバーにして動画を作ってください。',
    'video-file': 'この動画に字幕を付けてください。',
    export: 'この動画に字幕を付けてください。',
    video: 'この動画の編集を続けてください。',
  },
  handoverDefault: 'この結果の作業を続けてください。',
};
