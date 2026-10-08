import type { HomeBriefMessages } from './home-brief.ts';

export const zhHant: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `約 ${minutes ? `${minutes} 分鐘` : ''}${seconds ? `${minutes ? ' ' : ''}${seconds} 秒` : ''}`,
  fromMaterials: '根據我附上的材料製作一部影片。',
  materials: (paths: readonly string[]) => `材料：${paths.join('、')}`,
  connectFirst: '先連線 AI',
  sayFirst: '先說明你想製作什麼，或附上材料',
  agentOffTitle: '已安裝的程式設計 Agent 都已停用',
  agentOffBody: '這台電腦上已安裝程式設計 Agent，但在設定中已停用。啟用其中一個，就能直接在這裡開始。',
  enableNamed: (name: string) => `啟用 ${name}`,
  enableAgent: '啟用 Agent',
  agentMissingTitle: '這需要程式設計 Agent',
  agentMissingBody: '請安裝 Claude Code 或 Codex CLI，並以你自己的訂閱登入，然後回到這裡開始。',
  connectAgent: '連線 Agent',
  nameEmpty: '請輸入專案名稱',
  nameInvalid: '專案名稱不能包含斜線或控制字元',
};
