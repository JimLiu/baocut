import type { ToolFrameMessages } from './tool-frame.ts';

export const ja: ToolFrameMessages = {
  noneAvailable: (noun) => `利用できる${noun}がまだありません。設定で用意してください`,
  pickOne: (noun) => `先に${noun}を選んでください`,
  notInstalled: (name) => `${name} はまだインストールされていません`,
  notConnected: (provider) => `${provider} はまだ接続されていません`,
  unavailable: (name, why) => `${name} · ${why ?? '利用不可'}`,
  notInstalledWarning: (name) => `${name} はまだインストールされていません。インストール済みのものを選ぶか、設定でダウンロードしてください`,
  notConnectedWarning: (provider) => `${provider} はまだ接続されていません。使えるものを選ぶか、設定で接続してください`,
  noModel: (noun, local) =>
    local
      ? `利用できる${noun}がまだありません。設定でローカルモデルをインストールするか、クラウドサービスを接続してください。`
      : `利用できる${noun}がまだありません。設定でクラウドサービスを接続してください。`,
};
