import type { RcModelApiMessages } from './rc-model-api.ts';

export const ja: RcModelApiMessages = {
  serviceLabel: 'モデル API サービス',
  notRunning:
    'モデル API サービスはオフです。先に開始してください（baocut services start model-api）。開始しないとクライアントは接続できません。',
  aliasNotFound: (p: { alias: string }) => `エイリアス「${p.alias}」はありません`,
  internalError: '内部エラー',
  jobNotCompleted: 'タスクが完了しませんでした',
  jobCancelled: 'タスクは BaoCut でキャンセルされました',
  hostNotAllowed: 'Host がループバックアドレスではありません',
  originNotAllowed: 'Web ページからのリクエストは受け付けません',
  authRequired:
    'トークンがないか、無効です：Authorization: Bearer <トークン> を使ってください（BaoCut でこのアプリ用のクライアントを作成します）',
  methodNotAllowed: (p: { path: string; method: string }) => `${p.path} が受け付けるのは ${p.method} のみです`,
  endpointNotFound: (p: { path: string }) => `このエンドポイントはありません：${p.path}`,
  modelNotFound: (p: { model: string }) => `モデル「${p.model}」はありません：GET /v1/models で使用可能なモデルを一覧できます`,
  readOnly: 'このサービスは照会のみ可能です',
  readOnlyHint:
    'このサービスは照会のみ可能です（GET /v1/models）：BaoCut でモデル API サービスのレベルを ask または auto に変更してください',
  tooManyRequests: (p: { limit: number }) =>
    `このクライアントには処理中のリクエストがすでに ${p.limit} 件あります：完了してから次を送信してください`,
  multipartRequired: 'リクエスト本文は multipart/form-data にしてください（フィールド file と model）',
  uploadTooLarge: (p: { limit: number }) => `アップロードが上限（${p.limit} バイト）を超えています`,
  multipartInvalid: (p: { reason: string }) => `multipart の本文が不正です：${p.reason}`,
  fileFieldMissing: 'ファイルフィールド file がありません',
  fileEmpty: 'アップロードされたファイルが空です',
  bodyTooLarge: (p: { limit: number }) => `リクエスト本文が上限（${p.limit} バイト）を超えています`,
  invalidJson: 'リクエスト本文が有効な JSON ではありません',
  transcriptMissing: '文字起こしの出力が見つかりません',
  speechMissing: '合成した音声が見つかりません',
  imageMissing: '生成した画像が見つかりません',
  textMissing: '生成したテキストが見つかりません',
  summaryTranscribe: (p: { size: string; model: string }) => `${p.size} の音声を文字起こし、モデル ${p.model}`,
  summarySpeech: (p: { model: string; voice: string | null; chars: number }) =>
    `音声合成、モデル ${p.model}${p.voice ? `、声 ${p.voice}` : ''}、${p.chars} 文字`,
  summaryImages: (p: { count: number; model: string; promptChars: number }) =>
    `画像を ${p.count} 枚生成、モデル ${p.model}、プロンプト ${p.promptChars} 文字`,
  summaryChat: (p: { model: string; messages: number; chars: number; structured: boolean }) =>
    `テキスト生成、モデル ${p.model}、メッセージ ${p.messages} 件、${p.chars} 文字${p.structured ? '、構造化出力' : ''}`,
  defaultModel: '既定のモデル',
  modelWithCanonical: (p: { name: string; canonical: string }) => `${p.name}（${p.canonical}）`,
  grantPurpose: (p: { endpoint: string }) => `モデル API サービス：${p.endpoint}`,
  grantRequiredAsk: (p: { reason: string }) => `${p.reason}：BaoCut で許可を発行するようユーザに依頼してください`,
  approvalDenied: 'ユーザが BaoCut でこのリクエストを拒否しました',
  approvalTimeout:
    'ユーザが時間内にこのリクエストを確認しなかったため、拒否として扱いました：BaoCut の確認に注意するようユーザに依頼して、再試行してください',
  approvalCancelled: 'このリクエストは確認前にキャンセルされました（サービスが停止しました）',
  fieldMissing: (p: { key: string }) => `${p.key} がありません`,
  fieldNotString: (p: { key: string }) => `${p.key} は文字列にしてください`,
  fieldEmpty: (p: { key: string }) => `${p.key} は空にできません`,
  fieldNotNumber: (p: { key: string }) => `${p.key} は数値にしてください`,
  fieldNotInteger: (p: { key: string; min: number }) => `${p.key} は ${p.min} 以上の整数にしてください`,
  bodyNotObject: 'リクエスト本文は JSON オブジェクトにしてください',
  onlySupports: (p: { field: string; values: string }) => `${p.field} が対応しているのは ${p.values} のみです`,
  listSeparator: '、',
  speechStreamUnsupported: '音声のストリーミングには対応していません（stream_format は audio のみ）',
  libraryVoiceUnsupported:
    'モデル API サービスではユーザライブラリの声（library:<id>）を使用できません。プロバイダの声 ID を使ってください',
  imageUrlUnsupported:
    'response_format が対応しているのは b64_json のみです：このサービスは画像の URL を提供せず、画像は応答に含めて返します',
  imageStreamUnsupported: '画像のストリーミングには対応していません',
  messagesNotArray: 'messages は空でない配列にしてください',
  textOnlyChat: (p: { key: string }) => `${p.key} には対応していません：このサービスはテキストのみのチャットを提供します`,
  nOnlyOne: 'n には 1 しか指定できません',
  logprobsUnsupported: 'logprobs には対応していません',
  streamNotBoolean: 'stream はブール値にしてください',
  messageNotObject: (p: { index: number }) => `messages[${p.index}] はオブジェクトにしてください`,
  roleUnsupported: (p: { index: number }) =>
    `messages[${p.index}].role が対応しているのは system、developer、user、assistant のみです`,
  toolCallsUnsupported: 'ツールの呼び出しには対応していません',
  textContentOnly: (p: { index: number }) => `messages[${p.index}] が対応しているのはテキストの内容のみです`,
  contentInvalid: (p: { index: number }) => `messages[${p.index}].content は文字列またはテキストパーツの配列にしてください`,
  responseFormatNotObject: 'response_format はオブジェクトにしてください',
  jsonSchemaInvalid: 'response_format.json_schema.schema は JSON Schema オブジェクトにしてください',
  responseFormatTypeUnsupported: 'response_format.type が対応しているのは text、json_object、json_schema のみです',
  transcriptionStreamUnsupported: '文字起こしのストリーミングには対応していません',
  granularitiesInvalid: 'timestamp_granularities に指定できるのは word、segment のみです',
  capabilityTranscribe: '文字起こし',
  capabilitySynthesizeSpeech: '音声合成',
  capabilityGenerateImage: '画像生成',
  capabilityGenerateText: 'テキスト生成',
  capabilitySeparateAudio: 'ボーカル分離',
  modelNotFoundFor: (p: { capability: string; model: string }) =>
    `${p.capability}に使えるモデル「${p.model}」はありません：GET /v1/models で使用可能なモデルを一覧できます`,
  hintEnableOnline: (p: { capability: string }) =>
    `先に BaoCut で${p.capability}に対応したオンラインサービスを設定し、オンにしてください`,
  hintNoLocalModel: (p: { capability: string }) =>
    `${p.capability}用のローカルモデルがありません。リクエストをオンラインサービスに渡すには、BaoCut でモデル API サービスのオンラインルーティングをオンにし（baocut services configure model-api --route-online on）、オンラインサービスをオンにしてください`,
  capabilityUnavailable: (p: { capability: string; hint: string }) =>
    `このサービスは現在${p.capability}を実行できません：${p.hint}`,
};
