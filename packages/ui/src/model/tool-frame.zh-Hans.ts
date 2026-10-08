import type { ToolFrameMessages } from './tool-frame.ts';

export const zhHans: ToolFrameMessages = {
  noneAvailable: (noun) => `还没有可用的${noun}，先去设置`,
  pickOne: (noun) => `先选一个${noun}`,
  notInstalled: (name) => `${name} 还没安装`,
  notConnected: (provider) => `${provider} 还没连接`,
  unavailable: (name, why) => `${name} · ${why ?? '不可用'}`,
  notInstalledWarning: (name) => `${name} 还没安装，换一只已装的，或去设置下载`,
  notConnectedWarning: (provider) => `${provider} 还没连接，换一只能用的，或去设置连接`,
  noModel: (noun, local) => (local ? `还没有可用的${noun}：在设置里安装一个本机模型，或连接一家云端服务。` : `还没有可用的${noun}：在设置里连接一家云端服务。`),
};
