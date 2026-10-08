import type { ServicesApiMessages } from './services-api-copy.ts';

export const ja: ServicesApiMessages = {
  capabilities: {
    transcribe: '文字起こし',
    synthesizeSpeech: '音声合成',
    generateImage: '画像生成',
    generateText: 'テキスト生成',
  },
  endpoints: {
    models: 'モデルを一覧表示',
    model: 'モデルを取得',
    info: 'サービス情報とインターフェイスのバージョン',
    transcriptions: '音声を文字起こし',
    speech: '音声を合成',
    images: '画像を生成',
    chat: 'テキストを生成（チャット）',
  },
  routing: {
    online: {
      label: 'オンラインサービス',
      desc: '接続済みのクラウドサービスにリクエストを転送します（料金が発生する場合があり、データはこのコンピュータの外に送信されます）',
    },
    nodes: { label: 'LAN ノード', desc: 'ペアリング済みのほかのコンピュータにリクエストを転送します' },
    agent: { label: 'Agent', desc: 'このコンピュータでサインイン済みの Agent の実行環境（Codex など）にリクエストを転送します' },
  },
  modelsAvailable: (n) => `${n} 個のモデルが使用可能`,
  notRouted: '使用可能なモデルはありますが、そのカテゴリのルーティングがオフです。現在、リクエストには 503 が返されます',
  noModels: '使用可能なモデルはまだありません。現在、リクエストには 503 が返されます',
  defaultModel: '既定のモデル',
  target: (provider, model) => `${provider} · ${model}`,
  aliasProviderMissing: 'このプロバイダが見つかりません。リクエストには 404 が返されます',
  aliasNotRouted: 'このカテゴリのルーティングはオフです。リクエストには 404 が返されます',
  aliasProviderUnavailable: 'このプロバイダは現在使用できません',
  aliasModelUnavailable: 'このモデルは現在使用できません',
  targetNotRouted: 'ルーティングがオフ',
  targetUnavailable: '現在使用できません',
  aliasNameEmpty: '名前を入力してください（例：whisper-1）',
  aliasNameSlash: '名前に「/」は使えません。<プロバイダ>/<モデル> が正規の形式で、エイリアスはこれと重複できません',
  aliasNameChars: '使えるのは英字、数字、. _ : - だけで、先頭は英字か数字にしてください',
  aliasNameTaken: (name) => `「${name}」はすでに存在します。転送先を変えるには、先にその行を削除してください`,
};
