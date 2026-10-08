import type { RcGatewayMessages } from './rc-gateway.ts';

export const zhHans: RcGatewayMessages = {
  helloTimeout: '握手超时',
  textFramesOnly: '只接受文本帧',
  frameNotJson: '帧不是合法的 JSON',
  frameUnrecognized: '无法识别的帧',
  unknownMethod: (p: { method: string }) => `未知方法：${p.method}`,
  invalidParams: '参数不合法',
  helloRequired: '第一帧必须是 hello',
  invalidToken: '令牌无效',
  protocolMismatch: (p: { client: string; runtime: string }) => `协议版本不兼容：客户端 ${p.client}，Runtime ${p.runtime}`,
  internalError: '内部错误',
  catalogLocalOnly: '工具目录只给本机的 CLI 与桌面界面',
};
