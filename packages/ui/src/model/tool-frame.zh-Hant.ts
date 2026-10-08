import type { ToolFrameMessages } from './tool-frame.ts';

export const zhHant: ToolFrameMessages = {
  noneAvailable: (noun) => `還沒有可用的${noun}，請先到設定中新增一個`,
  pickOne: (noun) => `請先選擇一個${noun}`,
  notInstalled: (name) => `${name} 尚未安裝`,
  notConnected: (provider) => `${provider} 尚未連接`,
  unavailable: (name, why) => `${name} · ${why ?? '無法使用'}`,
  notInstalledWarning: (name) => `${name} 尚未安裝。請換一個已安裝的，或到設定中下載`,
  notConnectedWarning: (provider) => `${provider} 尚未連接。請換一個可用的，或到設定中連接`,
  noModel: (noun, local) =>
    local ? `還沒有可用的${noun}。請在設定中安裝本機模型，或連接雲端服務。` : `還沒有可用的${noun}。請在設定中連接雲端服務。`,
};
