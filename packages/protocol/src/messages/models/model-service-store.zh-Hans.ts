import type { ModelsModelServiceStoreMessages } from './model-service-store.ts';

export const zhHans: ModelsModelServiceStoreMessages = {
  notMigrated: '第 1 版的密钥还没有迁移',
  orderMismatch: 'order 要恰好列出这个服务商现有的每个账号一次',
  credentialNotSaved: (p: { reason: string }) => `凭据没有保存：${p.reason}`,
  accountNotFound: (p: { provider: string; account: string }) => `${p.provider} 没有这个账号：${p.account}`,
  accountLinked: (p: { home: string }) => `这个账号是从 ${p.home} 链接来的，要在那边改或删它的密钥`,
  linkSameHome: '不能从同一个 BaoCut 主目录链接账号',
  linkSourceFileBacked: (p: { home: string }) => `${p.home} 把密钥存在文件里，不在系统钥匙串里；只能链接用钥匙串的主目录`,
  linkSourceEmpty: (p: { home: string }) => `${p.home} 里没有 BaoCut 的模型服务配置`,
  linkNoMatch: (p: { home: string }) => `${p.home} 里没有匹配的账号`,
  linkedHelperMissing: (p: { home: string }) => `从 ${p.home} 链接来的账号读不了密钥：没找到装好的 BaoCut 应用里的凭据助手`,
  linkedSourceMissing: (p: { account: string; home: string }) => `链接账号 ${p.account} 已经不在 ${p.home} 里了`,
  linkedKeyMissing: (p: { account: string; home: string }) => `链接账号 ${p.account}（来自 ${p.home}）的密钥不在系统钥匙串里`,
  linkedUnreadable: (p: { account: string; home: string; reason: string }) => `链接账号 ${p.account}（来自 ${p.home}）的密钥读不了：${p.reason}`,
};
