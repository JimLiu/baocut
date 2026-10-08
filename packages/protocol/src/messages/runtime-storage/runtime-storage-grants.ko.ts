import type { RuntimeStorageGrantsMessages } from './runtime-storage-grants.ts';

export const ko: RuntimeStorageGrantsMessages = {
  localNeedsNoGrant: '로컬 계산에는 허가가 필요하지 않습니다',
  dataKindRequired: '데이터 종류를 하나 이상 지정하세요',
  budgetCapRequired: '지출 한도가 있는 허가에는 budgetCap이 필요합니다',
  unknownCostNoCap: '비용을 알 수 없는 허가에는 지출 한도를 둘 수 없습니다. 한도를 설정하려면 estimate-cap을 사용하세요',
  expiryPassed: '만료 시간이 이미 지났습니다',
  grantNotFound: '해당 허가가 없습니다',
  grantRevoked: '허가가 철회되어 변경할 수 없습니다. 새로 발급하세요',
  cannotRemoveCap: '지출 한도가 있는 허가는 한도를 없앨 수 없습니다. 철회한 뒤 비용을 알 수 없는 허가를 새로 발급하세요',
  unknownCostCannotCap: '비용을 알 수 없는 허가에는 지출 한도를 설정할 수 없습니다. 철회한 뒤 estimate-cap 허가를 새로 발급하세요',
  cannotChangeCurrency: '통화는 변경할 수 없습니다',
  expiryPassedRevoke: '만료 시간이 이미 지났습니다. 지금 중지하려면 철회하세요',
  revokeNote:
    '철회하면 새 호출은 더 이상 이루어지지 않고, 대기 중인 호출은 시작될 때 거부됩니다. 이미 공급자에게 보낸 데이터와 이미 발생한 비용은 로컬에서 되돌릴 수 없으며, 진행 중인 호출은 평소대로 끝나고 사용량에 포함됩니다.',
  taskCallLimit: '작업 예산의 호출 한도는 양의 정수여야 합니다',
  providerGrantPurpose: (p) => `${p.label} 항목을 켤 때 기본으로 발급됨`,
  invalidCurrency: (p) => `통화는 대문자 세 글자여야 합니다(ISO 4217): ${p.currency}`,
};
