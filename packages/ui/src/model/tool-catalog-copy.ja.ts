import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: '音声', image: '画像', doc: 'ドキュメント', final: '動画ファイル', subtitle: '字幕' };

export const ja: ToolCatalogMessages = {
  inputLabels: {
    file: 'ローカルファイル',
    space: 'Space',
    link: 'リンク',
    text: 'テキスト',
    video: 'Space の動画',
    document: 'ドキュメント',
  },
  outputLabels: { video: '動画', artifact: 'Space の項目' },
  artifactLabels,
  tools: {
    transcribe: {
      name: '文字起こし',
      desc: '動画や音声ファイルを文字起こしと字幕にします。編集可能な動画を選ぶとそこに書き込み、字幕レイヤーを追加します',
    },
    'translate-subtitles': {
      name: '字幕を翻訳',
      desc: '字幕を別の言語に翻訳します。文字起こし済みの動画を選ぶと、翻訳と、2 言語を表示できる字幕レイヤーを追加し、原文はそのまま残します',
    },
    dub: {
      name: '翻訳吹き替え',
      desc: '文字起こし済みの動画に、翻訳から新しい吹き替えを付けます。元の音声は下げる、ミュート、そのまま残すから選べます',
    },
    'synthesize-speech': {
      name: '音声を生成',
      desc: 'テキストや、Space のドキュメントと字幕を読み上げます。プリセットの声を使うか、録音をクローンするか、声を説明して作ります',
    },
    'generate-text': {
      name: 'テキストを生成',
      desc: '必要な内容を書くと、テキストモデルを直接呼び出してコピー、台本、要約を作ります。Space のドキュメントや字幕を資料として添付できます',
    },
    'generate-image': {
      name: '画像を生成',
      desc: '画像を説明すると、クラウドまたはローカルの画像モデルで描きます。参照画像、アスペクト比、枚数は任意です',
    },
    'link-import': {
      name: '動画をダウンロード',
      desc: 'リンクを貼り付けて動画をこのコンピュータにダウンロードします。ブラウザの Cookie を使え、ダウンロードしたものは文字起こしと字幕にできます',
    },
    'compress-video': {
      name: '動画を圧縮',
      desc: '目標のサイズまたは画質で再エンコードします。送信やアップロードの前に小さくできます',
    },
    'merge-video': {
      name: '動画を結合',
      desc: '複数の動画を順番につなげて 1 つのファイルにします',
    },
    'extract-audio': {
      name: '音声を抽出',
      desc: '映像を除いて音声トラックだけを残します。一般的な音声コーデックは再エンコードせず、そのままコピーします',
    },
  },
  targetNone: '文字起こしと字幕だけを作成',
  targetCreate: 'プロジェクトに動画を作成',
  subtitleFile: 'ローカルの字幕ファイル',
  groups: {
    speech: {
      label: '音声と字幕',
      desc: '文字起こし、字幕の翻訳、吹き替えの追加、テキストの読み上げ。結果はドキュメント、字幕、音声の項目です。Space で編集可能な動画を選ぶとそこに書き込みます。',
    },
    'text-image': { label: 'テキストと画像', desc: 'テキストモデルと画像モデルを直接呼び出します。結果はドキュメントと画像の項目です。' },
    'video-file': {
      label: '動画ファイル',
      desc: 'このコンピュータの yt-dlp と ffmpeg で、動画のダウンロード、圧縮、結合と音声の抽出を行います。結果は動画ファイルと音声の項目です。',
    },
  },
  artifactItems: (artifacts) => `${artifacts.map((a) => artifactLabels[a]).join('と') || '生成物'}の項目`,
  resultWritesVideo: '結果：選んだ動画に書き込みます',
  resultInSpace: (items) => `結果：Space の${items}`,
  resultAlsoCreate: '新しい動画も作成できます',
  resultWritesEditable: '編集可能な動画を選ぶとそこに書き込みます',
  joinResult: (parts) => parts.join('。'),
};
