import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = '이미 다운로드한 부분은 유지되며, 다음 다운로드는 중단된 곳부터 이어집니다.';

export const ko: ModelsInstallMessages = {
  // ---- 确认对话框 ----
  planSize: (size) => `${size} 다운로드`,
  planSizeEstimate: (size) => `약 ${size}(일부 파일 크기를 알 수 없어 등록된 추정치 사용)`,
  amountEstimate: (size) => `약 ${size}`,
  noSpace: (need, have) =>
    `디스크 공간이 부족합니다: ${need} 공간이 필요하지만 모델 폴더가 있는 디스크에는 ${have}만 남아 있습니다. 공간을 확보한 뒤 다운로드하세요.`,
  resumed: (size) => `지난번에 다운로드한 ${size} 분량은 다시 받지 않고 그대로 사용합니다.`,
  space: (size) => `디스크 여유 공간 ${size}`,
  lineKeep: '이미 설치됨 · 그대로 둠',
  lineSize: (size, count) => `${size} · 파일 ${count}개`,
  lineUnknown: (count) => `크기 알 수 없음 · 파일 ${count}개`,
  // ---- 进度 ----
  queued: '다운로드 대기 중',
  downloading: (amount) => `다운로드 중 ${amount}`,
  downloadingUnknown: (amount) => `다운로드 중 · ${amount} 받음`,
  verifying: '검증 및 반영 중',
  pausedKept: (amount) => `일시 중지됨 · ${amount} 보존됨, 다시 시작하면 중단된 곳부터 이어집니다`,
  paused: '일시 중지됨',
  // ---- 失败与补救 ----
  remedyNoSpace: (need, have) =>
    `${need !== null && have !== null ? `${need} 공간이 필요한데 ${have}만 남아 있습니다. ` : ''}디스크 공간을 확보한 뒤 다시 다운로드하세요. ${KEEP}`,
  remedyNetwork: `네트워크를 확인한 뒤 다시 다운로드하세요. ${KEEP} 기본 소스에 연결할 수 없으면 설정 › 일반의 “모델 다운로드 소스”에서 미러로 바꾸세요.`,
  remedyIntegrity:
    '다운로드 소스에서 받은 파일이 매니페스트의 크기 또는 sha256과 일치하지 않아 잘못된 파일을 삭제했습니다. 다른 다운로드 소스(설정 › 일반의 “모델 다운로드 소스”)로 바꾼 뒤 다시 다운로드하세요.',
  remedySource:
    '다운로드 소스에 이 파일이 없거나 접근이 거부되었습니다. 설정 › 일반의 “모델 다운로드 소스”(또는 BAOCUT_MODELS_ENDPOINT 환경 변수)에 지정한 미러가 완전한지 확인하세요.',
  remedyManifest: '이 모델 패키지의 내장 매니페스트에 신뢰할 수 있는 sha256이 없어, BaoCut이 업데이트될 때까지 설치할 수 없습니다.',
  remedyOffline: '엄격한 오프라인 모드가 켜져 있어 아무것도 다운로드하지 않습니다. 다운로드하려면 먼저 설정에서 엄격한 오프라인 모드를 끄세요.',
  remedySizeChanged: '다운로드 크기가 바뀌었습니다. 새 계획으로 다시 확인하세요.',
  remedyInUse:
    '작업이 이 모델 패키지를 사용하고 있습니다(전사, 합성, 검사 또는 설치). 끝날 때까지 기다리거나 백그라운드 작업에서 취소한 뒤 다시 삭제하세요.',
  remedyUnavailable:
    '지금은 이 모델 패키지를 사용할 수 없습니다(설치가 완료되지 않았거나, 꺼져 있거나, 이 컴퓨터에서 지원하지 않음). 먼저 복구하거나 다시 켜세요.',
  remedyInstallFailed: `다시 다운로드해 보세요. ${KEEP}`,
  problemText: (message, remedy) => (/[.!?。！？]$/.test(message) ? `${message} ${remedy}` : `${message}. ${remedy}`),
  // ---- 删除 ----
  removalBody: (unknown, frees, kept) =>
    [
      unknown ? '이 모델 패키지만 쓰는 파일을 삭제합니다.' : frees !== null ? `약 ${frees}의 공간이 확보됩니다.` : null,
      ...kept.map((k) => `${k.repo} 구성 요소는 ${k.usedBy.join(', ')}에서 아직 사용하므로 유지됩니다.`),
      '다시 사용하려면 다시 다운로드해야 합니다.',
    ]
      .filter(Boolean)
      .join(' '),
  removed: (bundleId) => `${bundleId} 삭제됨`,
  removedKept: (bundleId, repos) => `${bundleId} 삭제됨 · ${repos.join(', ')} 구성 요소는 다른 모델 패키지가 아직 사용하므로 유지됨`,
};
