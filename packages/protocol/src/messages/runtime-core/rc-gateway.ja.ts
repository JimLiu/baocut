import type { RcGatewayMessages } from './rc-gateway.ts';

export const ja: RcGatewayMessages = {
  helloTimeout: 'ハンドシェイクがタイムアウトしました',
  textFramesOnly: 'テキストフレームのみ受け付けます',
  frameNotJson: 'フレームが有効な JSON ではありません',
  frameUnrecognized: '認識できないフレームです',
  unknownMethod: (p: { method: string }) => `不明なメソッド：${p.method}`,
  invalidParams: 'パラメータが不正です',
  helloRequired: '最初のフレームは hello にしてください',
  invalidToken: 'トークンが無効です',
  protocolMismatch: (p: { client: string; runtime: string }) =>
    `プロトコルバージョンに互換性がありません：クライアント ${p.client}、Runtime ${p.runtime}`,
  internalError: '内部エラー',
  catalogLocalOnly: 'ツールカタログを利用できるのは、このコンピュータの CLI とデスクトップアプリのみです',
};
