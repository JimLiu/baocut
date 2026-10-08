import type { DriversClaudeMessages } from './drivers-claude.ts';

export const ko: DriversClaudeMessages = {
  plan: 'Claude Pro 또는 Max 구독',
  installHint: 'Claude Code를 설치하세요',
  signedOut: 'Claude Code에 로그인되어 있지 않습니다. 터미널에서 claude를 실행하고 안내에 따라 로그인하세요.',
  subscriptionPro: 'Claude Pro 구독',
  subscriptionMax: 'Claude Max 구독',
  subscriptionTeam: 'Claude Team 구독',
  subscriptionEnterprise: 'Claude Enterprise 구독',
  providerAnthropicAws: 'Anthropic(AWS)',
  providerAnthropicGoogleCloud: 'Anthropic(Google Cloud)',
  enterpriseGateway: '엔터프라이즈 게이트웨이',
  claudeAccount: 'Claude 계정',
  longLivedToken: 'Claude 구독(장기 토큰)',
  apiKey: 'Anthropic API 키',
  thirdPartyCloud: '서드파티 클라우드',
  fromSettings: (p) => `Claude Code 설정에서 가져옴(env.${p.key})`,
  imageUnsupported: (p) => `Claude는 이 이미지 형식을 지원하지 않습니다: ${p.mimeType}(지원 형식: JPEG, PNG, GIF, WebP)`,
  defaultModel: '기본 모델',
  switchModelFailed: (p) => `Claude가 모델을 전환하지 못했습니다(${p.model}): ${p.error}`,
  autoUnsupported: (p) =>
    `${p.model ? `${p.model} 모델은` : '현재 모델은'} Claude의 “자동” 권한 모드를 지원하지 않습니다${p.reason ? `(${p.reason})` : ''}. 이번 턴은 “매번 확인” 모드로 실행되며 동작 전에 먼저 확인합니다.`,
  apiRetry: (p) => `Claude API 오류(${p.error}), 재시도 ${p.attempt}/${p.max}`,
  turnFailed: (p) => `Claude Code 턴이 실패했습니다(${p.subtype})`,
  exitedPlanMode: (p) =>
    `Claude Code가 승인된 계획으로 계획 모드를 종료했으며 이제 수정을 시작합니다. 접근 모드가 아직 “${p.plan}” 모드이면 이 수정은 거부됩니다. ` +
    `진행하게 하려면 접근 모드를 “${p.edit}” 모드나 다른 단계로 바꾸세요.`,
};
