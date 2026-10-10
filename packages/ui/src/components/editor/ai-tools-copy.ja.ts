import type { AiToolsMessages } from './ai-tools-copy.ts';

export const ja: AiToolsMessages = {
  back: '戻る',

  // 设置态
  who: '使用',
  whoAgent: 'Agent に任せる',
  whoModel: 'モデルを直接呼び出す',
  whoModelSub: 'この項目にはまだ Runtime のワークフローがないため、Agent にのみ任せられます',
  scope: '範囲',
  scopeAll: '全編',
  scopeChapter: (index: number, label: string) => `チャプター ${index} · ${label}`,
  scopeNoChapters: 'タイムラインにまだチャプターがないため、全編のみ選べます',
  cta: 'Agent に任せる',
  queued: 'Agent は作業中です · メッセージはキューに入り、このターンが終わると送信されます',
  noConversation: 'この動画はどのプロジェクトにもセッションにも属していないため、Agent に任せられません。',
  createFailed: (message: string) => `セッションを作成できませんでした：${message}`,

  // 勾选项与自定义
  prePolish: '先に推敲する（自動で段落分け）',
  prePolishOn: 'チャプターは段落単位でまとめられます',
  prePolishOff: '推敲していない文字起こしは 1 段落しかないため、チャプターが大まかになります',
  staleEdited: '原文が編集された文',
  staleEditedSub: '文字起こしの文言を変更しましたが、翻訳は古いままです',
  staleCut: '原文がカットされた文',
  staleCutSub: 'カットで文の一部が削除されました。カット後の原文から翻訳し直します',
  staleNone: '少なくとも 1 つ選択してください',
  staleOnly: (language: string) => `${language} の翻訳のみ`,
  retranscribeModel: '音声モデルは、このコンピュータにインストールされているものから Agent が選びます。指定したい場合は下の指示に書いてください。',
  retranscribeSpeakers: '文字起こしの後に話者を識別する',

  // 写作与发布
  platform: '投稿先',
  platformPlaceholder: '投稿するプラットフォーム（任意）。そのプラットフォームの規定に沿って書き、確認するよう知らせます',
  titleCount: '候補数',
  titleCountNote: (min: number, max: number) => `${min}〜${max} 個、それぞれ異なる切り口で`,
  coverCount: '枚数',
  coverIdea: '伝えたい 1 つのこと',
  coverIdeaPlaceholder: 'この動画で一番クリックしてもらいたいポイント（任意）。空欄の場合は Agent が文字起こしから探します',
  coverRatio: 'アスペクト比',
  coverRatioProject: '動画のキャンバスと同じ',
  coverText: 'カバーの文字',

  // 还做不了的
  soon: '近日公開',
  chaptersPolishFirst: '先に推敲して段落に分けてから、チャプターを生成してください',

  session: 'セッション',
  promptLabel: 'Agent に伝えること',
  promptPlaceholder: '何をどうするか。@ で章や話者を参照',
  restoreDefault: '既定に戻す',
  skillNote: 'このツールのやり方',
  noSkill: 'skill が付いていません。上のプロンプトだけで進めます。',
  addSkillBack: 'このツールの skill を戻す',
  sentNew: 'Agent に渡しました · 新しいセッション',
  sentCurrent: 'Agent に渡しました · 現在のセッションで続行',
  agentCardTitle: '下にない作業は、一言で Agent に任せる',
  agentCardSomeAgent: 'Agent',
  agentCardOutside: 'この動画のセッションを開き、動画を文脈にします →',
  noTranscriptTitle: 'この動画にはまだ文字起こしがありません',
  noTranscriptBody: 'ここのツールはすべて文字起こしが出発点です。整文・章分け・要約・タイトルには先に文字起こしが必要です。',
  goTranscribe: '文字起こしへ',
  stateRunning: '実行中',
  stateReview: '確認待ち',
  agentCardNew: (agent) => `新しいセッションで、この動画を文脈にします。この PC の ${agent} で動き、書き込む前に確認します →`,
  stateChapters: (count) => `${count} 章`,
};
