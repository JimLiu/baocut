import type { RcGatewayMessages } from './rc-gateway.ts';

export const zhHant: RcGatewayMessages = {
  helloTimeout: '交握逾時',
  textFramesOnly: '只接受文字訊框',
  frameNotJson: '訊框不是有效的 JSON',
  frameUnrecognized: '無法辨識的訊框',
  unknownMethod: (p: { method: string }) => `未知的方法：${p.method}`,
  invalidParams: '參數無效',
  helloRequired: '第一個訊框必須是 hello',
  invalidToken: '權杖無效',
  protocolMismatch: (p: { client: string; runtime: string }) => `通訊協定版本不相容：用戶端 ${p.client}，Runtime ${p.runtime}`,
  internalError: '內部錯誤',
  catalogLocalOnly: '工具目錄只提供給本機的 CLI 和桌面應用程式',
};
