import type { AiToolsMessages } from './ai-tools.ts';

const SOON_TAIL = 'Runtime にはまだこのワークフローがなく、動画上でフレーミングを調整するオーバーレイもないため、ここではまだ入力フォームを用意していません。';

export const ja: AiToolsMessages = {
  groups: {
    frame: '画面',
    transcript: '文字起こし',
    translate: '翻訳',
    writing: '執筆',
    publish: '公開',
  },
  tools: {
    crop: {
      name: 'スマートクロップ',
      desc: '話者やホワイトボードなどの重要な被写体をフレームに収めたまま、アスペクト比を変えます',
      why: `スマートクロップでは、話者やホワイトボードなどの重要な被写体を動画全体で追いかけたうえで、新しいアスペクト比で切り抜く必要があります。${SOON_TAIL}`,
    },
    shortscut: {
      name: 'ショート動画に切り出す',
      desc: 'この動画からいくつかの区間を選び、それぞれを縦型のショート動画にします',
      why: `ショート動画への切り出しでは、いくつかの区間を選んでそれぞれ縦型に切り抜き、動画上で区間ごとにフレーミングを調整します。${SOON_TAIL}`,
    },
    polish: {
      name: '文字起こしを校正',
      desc: '誤字を直し、句読点を補って段落に分けます。言葉は書き換えません',
      setup: ['明らかな誤字を直し、抜けている句読点を補って、話題ごとに段落に分けます。', '言い回しは書き換えず、内容も削りません。明らかな書き間違いだけを直します。'],
    },
    chapters: {
      name: 'チャプターを生成',
      desc: '長い動画をタイトル付きのチャプターに分けます',
      setup: ['段落を話題ごとにまとめてチャプターにし、それぞれにタイトルを付けます。', '書き出しと共有ページでも同じチャプターを使います。'],
    },
    speakers: {
      name: '話者を識別',
      desc: '誰が話しているかを区別し、字幕と文字起こしに名前を付けます',
    },
    retranscribe: {
      name: '再文字起こし',
      desc: '別のモデルで音声を処理し直します。1 つのチャプターや区間だけでもかまいません',
      setup: ['別の音声モデルで処理し直し、この範囲の単語レベルのデータを置き換えます。', '範囲外の文字起こし、字幕、訳文は一字も変わりません。'],
    },
    cleanup: {
      name: 'カット候補を探す',
      desc: 'フィラー、長い間、失敗テイクを見つけます。提案を確認してからカットします',
      setup: ['フィラー、0.8 秒以上の長い間、言い直しを探します。', 'カットする前に、カット案の一覧を確認できます。'],
    },
    translate: { name: '字幕を翻訳', desc: '1 文ずつ翻訳し、単語レベルのデータでタイムコードを合わせます' },
    stale: {
      name: '古くなった訳文を更新',
      desc: '原文が編集またはカットされた文だけを訳し直します',
      setup: [
        '原文が変わった文だけを訳し直します。編集した文と、カットで一部が削られた文です。',
        'カット後の原文から翻訳します。丸ごとカットされた文の訳文は一緒にカットされます。それ以外は変わりません。',
      ],
    },
    dub: {
      name: '翻訳吹き替え',
      desc: '言語を選ぶと、動画がその言語で話します。本人らしい声かネイティブらしい声を選べ、既定のままでも始められます',
    },
    summary: { name: 'まとめを書く', desc: '本文とタイムスタンプ付きの要点。時刻をクリックするとその位置へ移動します' },
    blog: { name: 'ブログ記事を書く', desc: '作者の視点または視聴者の視点で、記事に書き直します' },
    title: { name: 'タイトルを考える', desc: '切り口の異なる候補をいくつか出し、1 つを選びます' },
    desc: { name: '概要を書く', desc: '公開用の概要。チャプターのタイムコードとタグ付き' },
    cover: { name: 'サムネイルを作る', desc: 'キーフレームからサムネイル候補をいくつか作り、1 つを選びます' },
  },
  unknownTool: (id: string) => `その AI ツールはありません：${id}`,
  cleanup: {
    fillers: {
      label: 'フィラー',
      sub: '「えー」「あの」「えっと」「なんか」などの言葉',
      off: 'フィラー',
    },
    pauses: { label: '長い間 ≥ 0.8s', sub: '単語レベルのタイミングで検出', off: '長い間' },
    repeats: {
      label: '言い直し',
      sub: '同じ文を 2 回言い始めたもの。後のほうを残します',
      off: '言い直し',
    },
  },
  cleanupOff: (offs: readonly string[]) => `${offs.join('、')}は探さないでください`,
  lengths: { short: '短め', medium: '標準', long: '長め' },
  styles: {
    plain: '平易',
    pop: '解説',
    sharp: '辛口',
    light: 'カジュアル',
    pro: '専門的',
    custom: 'カスタム…',
  },
  views: { auto: '自動', author: '作者として', viewer: '視聴者として' },
  coverText: {
    none: '文字なし',
    phrase: '短いフレーズ',
    'phrase-sub': 'フレーズと小さな文字 1 行',
  },
  viewName: { author: '作者', viewer: '視聴者' },
  extraScope: (scope: string) => `「${scope}」だけを対象にしてください`,
  extraLength: (label: string) => `長さ：${label}`,
  extraStyle: (style: string) => `文体：${style}`,
  extraLanguage: (language: string) => `${language}で書いてください`,
  extraView: (view: string) => `視点：${view}`,
  extraPlatform: (platform: string) => `公開先：${platform}。その規約に沿って書き、書き終えたら確認するよう知らせてください`,
  extraIdea: (idea: string) => `サムネイルで伝えたいこと：${idea}`,
  extraRatio: (ratio: string) => `アスペクト比 ${ratio}`,
  extraCoverText: (label: string) => `サムネイルの文字：${label}`,
  titled: (title: string) => `「${title}」`,
  thisVideo: 'この動画',
  sourceEdited: (n: number | null) => (n === null ? '原文を編集' : `原文で ${n} 文を編集`),
  sourceCut: (n: number | null) => (n === null ? '原文をカット' : `原文で ${n} 文をカット`),
  sourceJoin: (parts: readonly string[]) => parts.join('、'),
  intents: {
    stale: (o) =>
      `${o.p}の訳文の一部が古くなっています${o.why ? `（${o.why}）` : '（原文が編集されたため）'}。該当する文だけを訳し直してください${o.cut ? '。カットされた文はカット後の原文から訳し直し、丸ごとカットされた文の訳文は一緒に削除してください' : ''}。それ以外は一字も変えないでください。`,
    polish: (o) =>
      `${o.scope ? `${o.p}の${o.scope}` : o.p}の文字起こしを校正してください。誤字を直し、句読点を補い、話題ごとに段落に分けてください。言い回しは書き換えないでください。`,
    chapters: (o) => `${o.p}を話題ごとにチャプターに分け、各チャプターに短いタイトルを付けてください。`,
    speakers: (o) => `${o.scope ? `${o.p}の${o.scope}` : o.p}の話者を識別してください。動画に書き込む前に、結果を見せて確認させてください。`,
    retranscribe: (o) => `別の音声モデルで${o.scope ? `${o.p}の${o.scope}` : o.p}を再文字起こしし、範囲外は一字も変えないでください。`,
    cleanup: (o) => `${o.scope ? `${o.p}の${o.scope}` : o.p}からフィラー、長い間、言い直しを探してください。まず一覧にして、確認してからカットしてください。`,
    summary: (o) => `${o.p}の文字起こしから、タイムコード付きの要点のまとめを書いてください。`,
    blog: (o) => `${o.p}を公開できるブログ記事に書き直してください。`,
    title: (o) => `${o.p}のタイトル候補を ${o.count} 個考えてください。それぞれ切り口を変えて 1 行ずつ理由を添え、1 つをおすすめしてください。`,
    desc: (o) => `${o.p}の公開用の概要を書いてください。チャプターのタイムコードと 1 行のタグを付けてください。`,
    cover: (o) =>
      `${o.p}のサムネイル候補を ${o.count} 枚作ってください。まずキーフレームを選び、1 枚ごとに異なる下地の作り方を使い、縮小表示で確認してから見せてください。`,
  },
  endSentence: (text: string) => (/[。！？.!?]$/.test(text) ? text : `${text}。`),
  joinPrompt: (head: string, extra: readonly string[]) => head + extra.join(''),
};
