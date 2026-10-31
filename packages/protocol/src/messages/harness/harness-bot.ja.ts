import type { HarnessBotMessages } from './harness-bot.ts';

export const ja: HarnessBotMessages = {
  roleLocked: 'この会話は Bot のチャンネルまたはタスクに属しています。チャンネルまたはタスクの設定から変更してください。',
  unattendedNeedsApprovals: (p) => `${p.agent} は手順ごとの承認に対応していないため、この手順はあなたがいるときに実行する必要があります。`,
};
