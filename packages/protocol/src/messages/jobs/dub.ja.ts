import type { JobsDubMessages } from './dub.ts';

export const ja: JobsDubMessages = {
  label: '翻訳吹き替え',
  description:
    '動画内の文字起こしを別の言語で吹き替えます。翻訳がなければ先に翻訳し、文ごとに音声を合成して元の文のタイミングに合わせ、吹き替えグループ（吹き替えトラック 1 本）として動画に適用します。Agent は起動しません。',
  stepFreezeSource: '原文の読み取り',
  stepTranslate: '翻訳',
  stepAssemble: '翻訳の組み立て',
  stepWrite: '翻訳の書き込み',
  stepCheck: '翻訳の確認',
  stepSeparate: 'ボーカルと背景音の分離',
  stepSynthesize: '文ごとの合成',
  stepAlign: 'タイミングの調整',
  stepApply: '吹き替えの適用',
  regroupConflict: (p: { params: string }) =>
    `文単位の再吹き替え（regroup）では、翻訳、言語、声、元の音声の扱いをそのグループの吹き替えプランから引き継ぐため、${p.params} と同時に指定できません`,
  orTranslationId: 'か translationId のどちらかが必要です',
  translationIdNoTranslate: 'translationId を指定した場合は翻訳しないため、style、glossary、glossaries、textProvider、textModel は適用されません',
  mustBeBooleanValue: 'はブール値である必要があります',
  mustBeObject: 'はオブジェクトである必要があります',
  unitsCount: (p: { max: number }) => `には 1 から ${p.max} 個の翻訳ユニット ID が必要です`,
  mustBeUnique: 'に重複は含められません',
  seedInvalid: (p: { max: number }) => `は 'new' または 0 から ${p.max} までの整数である必要があります`,
  videoNotOpen: '動画が開かれていません',
  translationFromOther: (p: { translationId: string; from: string; expected: string }) =>
    `翻訳 ${p.translationId} の翻訳元は ${p.from} で、${p.expected} ではありません`,
  translationLanguage: (p: { translationId: string; language: string; expected: string }) =>
    `翻訳 ${p.translationId} の言語は ${p.language} で、${p.expected} ではありません`,
  noDocument: (p: { documentId: string }) => `動画にドキュメント ${p.documentId} がありません`,
  notTranslation: (p: { documentId: string; kind: string }) => `ドキュメント ${p.documentId} は ${p.kind} で、翻訳ではありません`,
  translationNotUsable: (p: { translationId: string; schema: string }) =>
    `翻訳 ${p.translationId} は ${p.schema} ではないため、吹き替えに使用できません`,
  noPlan: (p: { groupId: string }) => `動画にこの吹き替えグループ（${p.groupId}）の吹き替えプランがありません`,
  groupGone: (p: { groupId: string }) => `この吹き替えグループ（${p.groupId}）のクリップはもうタイムライン上にありません`,
  planNoTranslation: '吹き替えプランに翻訳が記録されていません',
  unitsNotInPlan: (p: { count: number; units: string }) =>
    `${p.count} 文がこの吹き替えグループのプランまたは翻訳にありません：${p.units}`,
  planNoVoice: '吹き替えプランに、合成に使ったプロバイダ、モデル、声が記録されていません',
  seedNotAccepted: (p: { model: string }) => `モデル ${p.model} はシード（seed）を受け付けません`,
  videoClosed: '動画が閉じられました',
  translationGone: '翻訳ドキュメントはもう動画内にありません',
  translationNotSchema: (p: { schema: string }) => `翻訳が ${p.schema} ではありません`,
  translationNotFromTranscript: 'この翻訳はこの文字起こしから作成されたものではありません',
  unitMissingIds: '翻訳に id または sourceSentenceId のないユニットがあります',
  separationNotConfigured:
    'ボーカルと背景音の分離が要求されましたが、分離機能（separateAudio）が設定されていません。この手順はスキップし、元の音声はそのまま扱います',
  unitsStale: (p: { count: number }) =>
    `${p.count} 文の翻訳が古くなっているため（原文や用語集が変更されたか、古いとマークされました）、合成されませんでした`,
  nothingToDub: '翻訳に吹き替えできる文がありません：すべて古くなっているか空です',
  separationUnavailable: 'ボーカルと背景音の分離は使用できなくなりました',
  noSourceAsset: '文字起こしに元の素材がないため、分離できません',
  sourceAssetMissing: '文字起こしの元の素材を使用できません',
  separationInvalid: '分離の出力が規定を満たしていません',
  inputNoAudio: '入力に音声がありません',
  stemNoAudio: (p: { name: string }) => `${p.name} に音声がありません`,
  stemSampleRate: (p: { name: string; rate: number; input: number }) =>
    `${p.name} のサンプルレート（${p.rate}）が入力（${p.input}）と異なります`,
  stemDuration: (p: { name: string; duration: number; input: number }) =>
    `${p.name} の長さは ${p.duration} 秒ですが、入力は ${p.input} 秒です`,
  sentenceJob: (p: { n: number }) => `${p.n} 文目`,
  audioUndecodable: '合成した音声をデコードできません',
  outputNoAudio: '合成の出力に音声がありません',
  synthesisStopped: (p: { cause: string; synthesized: number; remaining: number }) =>
    `${p.cause}。${p.synthesized} 文を合成済みで、残りは ${p.remaining} 文です。再試行すると残りの文だけを合成します`,
  synthesisFailed: (p: { failed: number; synthesized: number }) =>
    `${p.failed} 文の合成に失敗しました。成功した ${p.synthesized} 文は残してあり、再試行すると失敗した文だけを合成します`,
  voicesUnavailableAll: (p: { speakers: string }) =>
    `話者（${p.speakers}）に割り当てられた声を使用できないため、どの文も合成できませんでした。声を修正（クローンし直すか同意文を追加）してから再試行してください`,
  voicesUnavailable: (p: { count: number; speakers: string }) =>
    `${p.count} 文は話者（${p.speakers}）に割り当てられた声を使用できないため、合成されませんでした。別の声での代用はしていません`,
  mutedUnvoiced: (p: { count: number }) =>
    `ミュートした ${p.count} 個のクリップには、声を使用できず合成されなかった文も含まれています。それらの文の元の音声もミュートされました`,
  unitsOverlong: (p: { count: number; tempo: number }) =>
    `${p.count} 文は ${p.tempo} 倍速にして後続の無音部分を使っても収まらないため、タイムラインに配置しませんでした（台本の書き直しが必要です）`,
  unitsOffTimeline: (p: { count: number }) =>
    `${p.count} 文の翻訳は元の文がもうタイムライン上にないため、配置しませんでした`,
  nothingPlaced: 'タイムラインに収まる吹き替えの文がありません',
  artifactGone: (p: { artifactId: string }) => `生成物 ${p.artifactId} はもう存在しません`,
  stretchNoAudio: '速度を変更した後に音声がありません',
  videoClosedKept: '動画が閉じられました。合成した音声は生成物に残してあります',
  videoChanged:
    'タイミング調整の後に動画が変更されたため、何も適用しませんでした。再試行すると現在のタイムラインに合わせて調整し直します（合成した音声は再利用します）',
  sequenceGone: 'シーケンスはもう存在しません',
  backgroundMuted:
    '元の音声をミュートしました。人の声、音楽、環境音が混ざっている場合は、背景音も一緒に消えています（背景音は分離していません）',
  noTrackOrPlanId: '適用後に吹き替えトラックまたは吹き替えプランの ID を取得できませんでした',
  applyRejected: '吹き替えのトランザクションが拒否されました。合成した音声は生成物に残してあります',
  planGone: 'この吹き替えグループのプランはもう動画内にありません',
  regroupRejected: '吹き替えを再生成するトランザクションが拒否されました。合成した音声は生成物に残してあります',
  planNotSchema: (p: { schema: string }) => `吹き替えプランが ${p.schema} ではありません`,
  transactionLabel: (p: { language: string }) => `吹き替え（${p.language}）`,
  regroupLabel: (p: { language: string }) => `吹き替えを再生成（${p.language}）`,
  trackName: (p: { language: string }) => `吹き替え（${p.language}）`,
  assetName: (p: { language: string; n: number }) => `吹き替え（${p.language}）${p.n} 文目`,
  takeAssetName: (p: { language: string; n: number; k: number }) => `吹き替え（${p.language}）${p.n} 文目 · テイク ${p.k}`,
  itemName: (p: { n: number }) => `吹き替え ${p.n}`,
  backgroundName: (p: { language: string }) => `背景音（${p.language}）`,
  vocalsName: (p: { language: string }) => `ボーカル（${p.language}）`,
  planName: (p: { language: string }) => `吹き替えプラン（${p.language}）`,
  duckingName: (p: { language: string }) => `吹き替え（${p.language}）による元の音声のダッキング`,
};
