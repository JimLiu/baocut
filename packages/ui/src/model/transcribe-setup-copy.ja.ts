import type { TranscribeSetupMessages } from './transcribe-setup-copy.ts';

export const ja: TranscribeSetupMessages = {
  notConnected: '未接続',
  unavailable: '利用不可',
  autoDetect: '自動検出',
  hintNoModel: 'どの音声モデルを使うかまだ分かりません。上で選ぶと、認識のヒントに対応しているかが分かります。',
  hintUnsupported: (model: string, alt: string | null) =>
    `${model} は認識のヒントに対応していないため、このステップでは用語集とプロンプトを使えず、文字起こしの際に省略されます。${alt ? `文字起こしで使うには、${alt} に切り替えてください。` : ''}`,
  budget: (model: string, b: { custom: number; terms: number; chars: number; dropped: number }, max: number) => {
    const custom = b.custom ? `プロンプト ${b.custom} 文字` : 'プロンプトなし';
    const dropped = b.dropped ? ` · ほかに ${b.dropped} 件が入りきりません。先に並んでいる用語集から入ります` : '';
    return `${model} に送信：${custom} + 用語 ${b.terms} 件 · 約 ${b.chars} / ${max} 文字${dropped}`;
  },
  glossaryGone: '用語集ライブラリにありません · 今回は使用しません',
  glossaryTranslation: '翻訳用の用語集のため文字起こしには使えません · 今回は使用しません',
  anyLanguage: 'すべての言語',
  termCount: (count: number) => `${count} 件`,
  noDefaultModel: '既定の音声モデルがまだありません',
  defaultModel: (label: string) => `${label}（既定）`,
  autoDetectLanguage: '言語を自動検出',
  glossaries: (count: number) => `用語集 ${count} 件`,
  hasPrompt: 'プロンプトあり',
  noDefaultFacts: '既定の音声モデルがまだありません。モデルを選ぶか、モデルページで既定を設定してください。選ばずに開始すると、何が足りないかが表示されます。',
  modelUnusable: 'このモデルは現在使用できません',
  acceptsHint: '認識のヒントに対応',
  noHint: '認識のヒントに非対応',
  followDefault: (facts: string) => `既定を使用 · ${facts}`,
};
