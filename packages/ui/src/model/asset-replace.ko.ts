import type { AssetReplaceMessages } from './asset-replace.ts';

const KIND_TEXT = { video: '영상', image: '이미지', audio: '오디오' } as const;

export const ko: AssetReplaceMessages = {
  cantReplaceKind: '이 종류의 소재는 아직 교체할 수 없습니다.',
  sameKind: (kind) => `같은 종류의 소재로만 교체할 수 있습니다. 여기에는 ${KIND_TEXT[kind]} 소재가 필요합니다.`,
  sameAsset: '현재 소재와 같습니다. 다른 소재를 고르세요.',
  unused: '이 소재는 타임라인에서 사용되지 않아 교체할 대상이 없습니다.',
  tooShort: '새 소재가 너무 짧아 한 프레임도 채울 수 없습니다.',
  allLocked: '이 소재를 사용하는 클립이 모두 잠겨 있습니다(또는 컴포지션을 대신하는 사전 렌더링 클립입니다). 먼저 잠금을 해제하세요.',
  clipLocked: '이 클립은 잠겨 있습니다. 먼저 잠금을 해제하세요.',
  durationUnknown: '소재 길이를 알 수 없어 클립은 우선 현재 길이를 유지합니다.',
  longEnoughMany: '새 소재가 충분히 깁니다. 이 클립들의 길이는 바뀌지 않고 타임라인도 그대로입니다.',
  longEnoughOne: '새 소재가 충분히 깁니다. 클립 길이가 유지되고 타임라인도 그대로입니다.',
  shortenMany: (n: number, seconds: string) => `클립 ${n}개가 총 ${seconds}초 짧아지고`,
  shortenOne: (seconds: string) => `클립이 ${seconds}초 짧아지고`,
  moved: (head: string, n: number) => `${head}, 트랙에서 뒤따르는 클립 ${n}개가 앞으로 당겨집니다.`,
  trackShorter: (head: string) => `${head}, 트랙도 짧아집니다.`,
  transitions: (n: number) => `이 클립들에 있는 전환 ${n}개가 제거됩니다.`,
  captions: (n: number) => `자막 ${n}개가 이 클립들에 맞춰 시간이 정해져 있어 교체한 뒤 다시 맞춰야 합니다.`,
  ducking: (n: number) => `더킹 규칙 ${n}개가 이 클립들을 가리키고 있어 교체한 뒤에는 맞지 않게 됩니다.`,
};
