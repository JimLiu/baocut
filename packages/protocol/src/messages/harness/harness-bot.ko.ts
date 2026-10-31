import type { HarnessBotMessages } from './harness-bot.ts';

export const ko: HarnessBotMessages = {
  roleLocked: '이 대화는 Bot 채널 또는 작업에 속해 있습니다. 채널이나 작업 설정에서 변경하세요.',
  unattendedNeedsApprovals: (p) => `${p.agent}은(는) 단계별 승인을 지원하지 않으므로 이 단계는 사용자가 있을 때 실행해야 합니다.`,
};
