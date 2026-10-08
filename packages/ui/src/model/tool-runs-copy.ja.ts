import type { ToolRunsMessages } from './tool-runs-copy.ts';

export const ja: ToolRunsMessages = {
  diarizeStep: '話者を識別',

  phaseDone: '完了',
  phaseQueued: '待機中',
  phaseCancelled: 'キャンセル済み',
  phaseUnfinished: '未完了',
  phasePreparing: '準備中',
  stepAt: (cur, total) => `ステップ ${cur} / ${total}`,
  cancelledAt: (step, at) => `「${step}」でキャンセル · ${at}`,
  stoppedAt: (step, at) => `「${step}」で停止 · ${at}`,
  runningAt: (step, at) => `${step} · ${at}`,
  stepDone: '完了',
  stepStopped: 'ここで停止',
  stepRunning: '進行中',
  stepWaiting: '待機',

  costEstimate: (amount, currency) => `約 ${amount} ${currency}`,
  costSubscription: (recipient) => `${recipient} のサブスクリプションに含まれます`,
  costFree: '無料',
  costMetered: (recipient) => `${recipient} の料金で課金されます。ここでは金額を見積もれません`,
  grantWhat: (kinds, purpose) => `${kinds.join('、')}（${purpose}）`,
  grantLoop: 'これらはすでに許可しましたが、Runtime がまだ拒否しています。設定 › プライバシーと権限でこれらの許可を確認するか、別のモデルに切り替えてください。',

  noStructuredOutput: 'このモデルは構造化出力に対応していないため、翻訳できません',

  captionsCreated: (p) =>
    `${p.language ? `${p.language}の字幕レイヤー` : '編集可能な字幕レイヤー'}を作成しました${p.bilingual ? '。2 言語で表示します' : ''}${
      p.disabled ? '（この素材にはすでに字幕が表示されているため、新しいレイヤーはオフで始まります）' : ''
    }`,
  captionsExistingTranslation: 'この翻訳にはすでに字幕レイヤーがあるため、新しく作成しませんでした',
  captionsExistingTranscript: 'この文字起こしにはすでに字幕レイヤーがあるため、新しく作成しませんでした',
  captionsNotOnTimeline: 'タイムライン上にこの素材を使うクリップがないため、字幕レイヤーを作成しませんでした',
  captionsEmpty: '表示する字幕がないため、字幕レイヤーを作成しませんでした',
  originalAudio: { duck: '元の音声を下げました', mute: '元の音声をミュートしました', keep: '元の音声を残しました' },

  thisVideo: 'この動画',
  newVideo: '新しい動画',
  fallbackVideo: '動画',
  media: 'メディア',
  savedFiles: (names) => `文字起こしと字幕を保存しました：${names.join('、')}`,
  transcriptLanguage: (language, model) => `文字起こしの言語：${language}${model ? `（${model}）` : ''}`,
  createdVideoLinked: (video, project) => `${project ? `「${project}」に` : ''}動画「${video}」を作成しました。素材は元の場所に置いたまま、リンクだけしています`,
  wroteTranscript: (video) => `「${video}」に文字起こしを追加しました`,
  speakersFound: (n) => `${n} 人の話者を検出しました。字幕と文字起こしに名前を付けました`,
  wroteTranslation: (video, language, source) =>
    `「${video}」に${language}訳を追加しました${source ? `（${source}の文字起こしから翻訳）` : ''}。原文は変更していません`,
  unitCount: (n) => `${n} 文`,
  subtitleFileWritten: (file, dir) => `翻訳した字幕ファイル ${file} を ${dir} に保存しました。字幕の数とタイムコードは変わりません`,
  bilingualLayout: '2 言語：原文が上、訳文が下',
  markupStripped: (n) => `原文の字幕 ${n} 件からインラインマークアップを削除しました`,
  dubTranslated: (language) => `先に${language}に翻訳し、新しい翻訳を追加しました`,
  dubReusedTranslation: (language) => `既存の${language}訳を使いました`,
  dubWritten: (video, language, engine) =>
    `「${video}」に新しい${language}の吹き替えを追加しました${engine ? `（${engine}）` : ''}。以前の吹き替えはそのまま残します`,
  dubPlaced: (placed, total) => `${total} 文中 ${placed} 文をタイムラインに配置しました`,
  linkCreatedVideo: (video, project) =>
    `${project ? `「${project}」に` : ''}動画「${video}」を作成しました。ダウンロードしたメディアはタイムラインに配置済みです`,
  linkAddedTo: (file, video) => `${file} を「${video}」に追加しました。ファイルはダウンロードフォルダに残ります`,
  linkDownloaded: (file, dir) => `${dir ? `${dir} に` : ''}${file} をダウンロードしました`,
  linkTranscribedFiles: '文字起こしが完了しました。TXT の文字起こしと SRT 字幕を保存しました',
  linkTranscribed: '文字起こしが完了し、文字起こしを追加しました。この方法では字幕レイヤーは作成されません。エディタの字幕パネルで作成できます',
  replacedTranscript: (video) => `「${video}」の文字起こしを置き換えました。1 回の操作として取り消せます`,
  newVideoFrom: (video, project, original) =>
    `動画「${video}」を${project ? `「${project}」に` : ''}作成し、同じ素材にリンクしました。${original ? `「${original}」` : '元の動画'}とその訳文はそのままです`,
  carryTranslation: (language, kept, reviewed, stale) =>
    `${language}訳 · 保持 ${kept} 文（レビュー済み ${reviewed}）· 古い訳文 ${stale} 文`,
  carryPins: (reanchored, orphaned) => `字幕 pin · 再アンカー ${reanchored} 件 · orphaned ${orphaned} 件`,
  carryDub: (language, kept, stale) => `${language}の吹き替え · 保持 ${kept} 文 · 古い ${stale} 文`,
  nothingToCarry: 'この動画には引き継ぐ訳文・字幕 pin・吹き替えがありませんでした',
  refreshHint: '古い訳文は「古くなった訳文を更新」で訳し直せます',
};
