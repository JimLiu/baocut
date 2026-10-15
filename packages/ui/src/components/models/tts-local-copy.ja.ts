import type { TtsLocalMessages } from './tts-local-copy.ts';

export const ja: TtsLocalMessages = {
  ttsLocal: {
    // 默认模型菜单没选时的占位（音乐生成也借用）
    unset: '未設定',
    // 行
    audition: '試聴',
    hideAudition: '試聴を隠す',
    engine: 'エンジン',
    license: 'ライセンス',
    components: 'コンポーネント',
    // 下载前的许可确认（设计稿 withModelLicense）
    licenseTitle: 'ライセンス',
    licenseUse: 'このモデルで合成した音声は非商用のコンテンツにのみ使用できます。商用利用する予定の動画では、別の音声モデルを選んでください。',
    licenseConfirm: (size: string) => `了解のうえ ${size} をダウンロード`,
    // 试听面板
    voice: '声',
    tone: '話し方',
    say: '話す内容',
    lines: 'セリフ',
    more: 'ほかの声',
    cloneNew: '新しい声をクローン…',
    writeOwn: '自分で入力',
    ownPlaceholder: '聞きたい文を入力',
    ownLabel: '試聴テキスト',
    describeLabel: '声の説明',
    describePlaceholder: '例：低く落ち着いた、ゆったり話す年配男性の声',
    builtinRef: (label: string, seconds: number | null) =>
      `参照用の録音 · ${label}${seconds !== null ? ` · ${seconds} 秒` : ''} · 書き起こしは自動で含まれます`,
    describedBuiltin: (label: string) => `説明から作る声 · 「${label}」に付属の説明を使用`,
    describePreset: (text: string) => `説明：${text}`,
    myVoice: (name: string) => `マイボイス · ${name} · 参照用の録音と書き起こしからクローン`,
    presetOnly: (models: string | null) =>
      models
        ? `このモデルには組み込みの話者しかありません · 「マイボイス」はクローンできるモデルで試してください：${models}（各モデルの行の試聴）`
        : 'このモデルには組み込みの話者しかありません · 「マイボイス」を試すには、先にクローンできるモデルをダウンロードしてください',
    nameList: (names: readonly string[]) => names.join('、'),
    cloneHint: '5–15 秒のクリアな話し声を用意してください。1 人だけが話し、BGM がないものです。WAV、MP3、M4A、FLAC、動画ファイルのいずれにも対応しています。',
    yourFile: (name: string) => `自分の録音 · ${name}`,
    sampleFile: (label: string) => `サンプル録音 · ${label} · BaoCut に付属しているので、ファイルを探す必要はありません`,
    pickFile: '録音を選択…',
    changeFile: '別の録音を選択…',
    useSample: 'サンプル録音を使用',
    crossLang: '言語をまたいでも使えます。中国語の録音で英語を読み上げることもできます。',
    noPicker:
      'ブラウザでは、このコンピュータ上のファイルを選べません。録音をその場限りで使うには、デスクトップアプリで選んでください。サンプル録音を使うか、先に「マイボイス」に保存することもできます。',
    pickTitle: '参照用の録音を選択',
    pickButton: '選択',
    pickFilter: '音声または動画',
    transcriptLabel: '録音の書き起こし（省略可）',
    transcriptHint: '録音で話している内容を書き添えると、より似た声になります',
    fileChip: (name: string, sample: boolean) => (sample ? `サンプル · ${name}` : name),
    generate: '試聴を生成',
    again: 'もう一度生成',
    cancel: 'キャンセル',
    busy: (phase: string) => `合成中 · ${phase}`,
    stalePrefix: '前回 · ',
    stale: 'この音声は前回の選択で作成されたものです。声やテキストを変えたら、「試聴を生成」をクリックして新しい音声を聞いてください。',
    download: 'ダウンロード',
    resultLabel: '試聴結果',
    credit: (credit: string) => `組み込みの声の録音：${credit}`,
    loadingAudio: '音声を読み込み中…',
    audioFailed: (message: string) => `音声を読み込めませんでした：${message}`,
    downloadFailed: (message: string) => `ダウンロードできませんでした：${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, '-')}-試聴.wav`,
    // 「我的声音」那一侧：`name` 是发起克隆的那只本地模型的名字
    handoffFrom: (name: string) => `「${name}」の試聴から · 録音するか動画から取り出してください。保存すると元の画面に戻ります`,
    handoffSaved: (name: string) => `保存しました · 「${name}」の試聴に戻ると、この声が選択されています`,
    handoffBack: '戻って使う',
    handoffCancel: '使わずに戻る',
    auditionClone: 'クローンを試聴',
    auditionCloneLabel: (name: string) => `クローンを試聴 · ${name}`,
    noCloneModel:
      'クローンできるローカルモデルがまだインストールされていません。先にローカルモデルのページでダウンロードしてください（IndexTTS2、Qwen3-TTS Base、GPT-SoVITS など）。',
    goLocal: 'ローカルモデルへ',
  },
};
