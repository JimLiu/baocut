import type { OnboardingMessages } from './onboarding-copy.ts';

export const ja: OnboardingMessages = {
  dialogLabel: 'BaoCut へようこそ',
  stepsLabel: 'セットアップの手順',
  step: {
    agent: 'Agent を接続',
    asr: '音声認識',
    tts: '音声合成',
    semantic: '意味検索',
    image: '画像生成',
    music: '音楽生成',
  },
  title: {
    agent: 'BaoCut へようこそ',
    asr: '音声認識モデルをダウンロード',
    tts: '音声合成モデルをダウンロード',
    semantic: '意味検索をインストール',
    image: '画像生成モデルをダウンロード',
    music: '音楽生成モデルをダウンロード',
  },
  lead: {
    agent: '作りたい動画を伝えるだけで、Agent が文字起こし、字幕付け、翻訳、吹き替え、編集をこなします。BaoCut はこのコンピュータにある Agent（Claude Code や Codex など）をあなた自身のアカウントで使うので、追加料金はかかりません。',
    asr: '文字起こしも、字幕付けも、トーク動画のカットも、まず話した内容を文字にするところから始まります。モデルはこのコンピュータで動き、オフラインでも使えます。',
    tts: '音声合成モデルは、テキストの読み上げ、録音からの声のクローン、翻訳した動画の吹き替えに使います。まずは 1〜2 個選んでください。ほかのモデルはあとから 設定 › 音声合成 でダウンロードできます。',
    semantic: '話した内容や映像を意味で探します。Space の検索、テーマで素材を選ぶ、映像を合わせる、翻訳メモリで使います。インストールすると、既存の動画のインデックス作成がバックグラウンドで始まります。',
    image: 'このコンピュータで一文から画像を生成し、表紙や挿絵に使えます。モデルが大きく、生成にも時間がかかります。',
    music: 'このコンピュータでスタイルや歌詞から BGM や楽曲を生成し、そのまま動画の音楽トラックに追加できます。生成には時間がかかり、30 秒分でおよそ数分です。',
  },
  where: {
    tts: {
      title: 'ツール › 音声を生成 で使う',
      body: 'テキストを書くか、Space のドキュメントや字幕を選び、モデルと声を選んで生成します。まだダウンロードしていないモデルもそこでダウンロードできます。',
    },
    image: { title: 'ツール › 画像を生成 で使う', body: '一文で描写するだけで画像ができます。Agent も表紙作りに使います。' },
    music: {
      title: 'ツール › 音楽を生成 で使う',
      body: 'スタイルを選んで歌詞を書きます。生成した音楽は Space に保存され、動画に追加できます。',
    },
  },
  diarizes: '文字起こしと同時に話者を区別',
  needsDiarization: (pack) => `話者を区別するには「${pack}」もダウンロード`,
  familyNote: {
    'qwen3-tts-1.7b-customvoice': 'プリセットの声 9 種 · 話し方を一文で指定',
    'qwen3-tts-0.6b-base': '3 秒の録音から声をクローン',
    voxcpm2: '録音から声をクローン · スタイルを指定可能 · 30 言語と広東語',
    'qwen-image-2.1-turbo': '蒸留版 · 8 ステップ固定 · ベースモデルの 2 倍以上高速',
    'qwen-image-2.1': 'ベースモデル · ステップが多く低速',
    'yue2-3b': 'スタイルや歌詞から生成 · 30 秒分でおよそ数分',
  },
  recommended: 'おすすめ',
  installed: 'インストール済み',
  missingParts: 'コンポーネント不足',
  planLine: (parts) => `一緒にダウンロード：${parts}`,
  downloading: (name) => `${name} をダウンロード中`,
  inBackground: 'バックグラウンドでダウンロード中',
  bgNote: 'ダウンロード前に、入手元と保存先が表示されます。確認してから始まり、バックグラウンドで進むので待つ必要はありません。',
  asrAlt: 'ダウンロードしたくない場合は、あとで 設定 › API プロバイダ でクラウドの音声認識を追加することもできます。',
  unsupported: 'このコンピュータではこれらのモデルを実行できません。この手順はスキップできます。',
  semanticParts: (text, multimodal) => `${text} + ${multimodal}`,

  agentListLabel: 'このコンピュータの Agent',
  agentChecking: 'このコンピュータの Agent を確認中…',
  agentMissingBody: '使いたいものにチェックを入れると、BaoCut がバックグラウンドでインストールします。インストール後、お持ちのアカウントで一度サインインすれば使えます。',
  agentNote: 'チェックした Agent は新しいセッションの Agent メニューに表示されます。インストールはバックグラウンドで進むので、待つ必要はありません。デフォルトの選択や追加は 設定 › Agent プロバイダ で行えます。',
  agentInstalled: 'このコンピュータにインストール済み',
  agentFix: (problem) => `${problem} · 設定 › Agent プロバイダ で解決`,
  agentManual: '公式の手順に従ってターミナルでインストール · 設定 › Agent プロバイダ を参照',
  agentNotInstalled: (plan) => (plan ? `未インストール · インストール後、お持ちの ${plan} でサインイン` : '未インストール'),
  agentWillInstall: (method, command, login) => `${method} でバックグラウンドにインストール（${command}）· その後ターミナルで ${login} を実行してサインイン`,
  agentInstalling: (method, login) => `${method} でバックグラウンドにインストール中 · その後ターミナルで ${login} を実行してサインイン`,
  agentInstallingLabel: (name) => `${name} をインストール中`,
  agentInstallFailed: 'インストールできませんでした · 詳細はバックグラウンドタスクにあります',

  next: '次へ',
  finish: '完了',
  skip: 'スキップ',
  exit: 'セットアップを終了',
  install: (n) => `${n} 個をバックグラウンドでインストールして続行`,
  download: (size, last) => `${size ? `${size} を` : ''}バックグラウンドでダウンロードして${last ? '完了' : '続行'}`,
  bg: {
    one: (kind, name, pct) => {
      const tail = pct === null ? '' : ` ${pct}%`;
      return `${name} を${kind === 'install' ? 'インストール中' : kind === 'download' ? 'ダウンロード中' : 'セットアップ中'}${tail}`;
    },
    many: (kind, n) =>
      `バックグラウンドで ${n} 個を${kind === 'install' ? 'インストール中' : kind === 'download' ? 'ダウンロード中' : 'セットアップ中'}`,
    idle: (kind) => `バックグラウンドの${kind === 'install' ? 'インストール' : kind === 'download' ? 'ダウンロード' : 'ダウンロードとインストール'}`,
    done: (kind, n) => `${n} 個${kind === 'install' ? 'インストール済み' : kind === 'download' ? 'ダウンロード済み' : '完了'}`,
    failed: (kind, n) => `${n} 個${kind === 'install' ? 'インストール失敗' : kind === 'download' ? 'ダウンロード失敗' : '未完了'}`,
  },
  closedToast: (models, agents) => {
    const parts = [...(models ? [`${models} 個のモデルをダウンロード中`] : []), ...(agents ? [`${agents} 個の Agent をインストール中`] : [])];
    return `バックグラウンドで ${parts.join('、')}です。完了するとすぐに使えます。`;
  },
  viewTasks: 'バックグラウンドタスクを表示',
};
