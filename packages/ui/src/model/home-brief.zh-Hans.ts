import type { HomeBriefMessages } from './home-brief.ts';

export const zhHans: HomeBriefMessages = {
  about: (minutes: number, seconds: number) => `约 ${minutes ? `${minutes} 分钟` : ''}${seconds ? `${minutes ? ' ' : ''}${seconds} 秒` : ''}`,
  fromMaterials: '根据我附上的材料制作一条视频。',
  materials: (paths: readonly string[]) => `材料：${paths.join('、')}`,
  connectFirst: '先连接 AI',
  sayFirst: '先说一句要做什么，或附上材料',
  agentOffTitle: '已安装的编码 Agent 都停用了',
  agentOffBody: '这台电脑上装过编码 Agent，只是在设置里停用了。启用一个，这里就能直接开始。',
  enableNamed: (name: string) => `启用 ${name}`,
  enableAgent: '启用 Agent',
  agentMissingTitle: '这一项要交给编码 Agent',
  agentMissingBody: '装 Claude Code 或 Codex CLI 并用你自己的订阅登录，回到这里就能直接开始。',
  connectAgent: '连接 Agent',
  nameEmpty: '请输入项目名称',
  nameInvalid: '项目名称不能包含斜杠或控制字符',
};
