import type { RuntimeStorageCredentialsMessages } from './runtime-storage-credentials.ts';

export const zhHans: RuntimeStorageCredentialsMessages = {
  denied: '访问被拒绝',
  unavailable: '凭据存储不可用',
  unsupported: '这个平台不支持系统的安全存储',
  internal: '读写凭据出错',
  problem: (p) => `${p.reason}：${p.message}`,
  fileWriteFailed: (p) => `写不进凭据文件（${p.code}）`,
  helperBadResponse: '凭据助手的响应不合规',
  helperNotFound: '没有找到凭据助手程序',
  helperTimedOut: (p) => `凭据助手 ${p.seconds} 秒内没有回应`,
  helperMissing: '凭据助手程序缺失',
  helperStartFailed: (p) => `凭据助手起不来（${p.code}）`,
  helperResponseTooLong: '凭据助手的响应过长',
  helperExitedSilently: '凭据助手没有回应就退出了',
  helperReportedError: '凭据助手报告了错误',
  redacted: '[已隐去]',
};
