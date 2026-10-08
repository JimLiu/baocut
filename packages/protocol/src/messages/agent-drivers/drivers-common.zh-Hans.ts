import type { DriversCommonMessages } from './drivers-common.ts';

export const zhHans: DriversCommonMessages = {
  executableMissing: (p) => `指定的 ${p.command}（${p.path}）不存在或不能执行。`,
  commandMissing: (p) => `没有找到 ${p.command} 命令。${p.hint}，或在设置里指定它的位置。`,
  commandNotFound: (p) => `没有找到 ${p.command} 命令`,
  installItFirst: '先安装它',
  versionFailed: (p) => `${p.command} --version 没有正常退出。`,
  outdated: (p) => `${p.name} ${p.version} 太旧，BaoCut 需要 ${p.min} 或更新。`,
  startFailed: (p) => `${p.name} 启动失败：${p.error}`,
  openSessionFailed: (p) => `${p.name} 开会话失败：${p.error}`,
  confinedUnsupported: (p) => `${p.name} 不支持受限的一次性调用`,
  resumeFailed: (p) => `无法恢复 ${p.name} 原生会话${p.error ? `（${p.error}）` : ''}，已新建会话：之前的对话内容智能体看不到。`,
  sessionClosed: (p) => `${p.name} 会话已关闭`,
  sessionNotReady: (p) => `${p.name} 会话尚未就绪`,
  turnInProgress: '上一轮还没有结束',
  modelSwitchFailed: (p) => `${p.name} 换不到模型 ${p.model}：${p.error}`,
  timedOut: (p) => `${p.label} 超时（${p.seconds} 秒）`,
  unknownError: '未知错误',
  unknownReason: '原因不明',
  imagePlaceholder: '[图片]',
  officialScript: '官方脚本',
};
