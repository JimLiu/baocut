import type { ModelsDirMessages } from './models-dir-copy.ts';

export const ko: ModelsDirMessages = {
  dir: {
    title: '모델 폴더',
    defaultChip: '기본값',
    envChip: '환경 변수',
    change: '변경…',
    restore: '기본값으로 복원',
    envNote: 'BAOCUT_MODELS_DIR 환경 변수로 지정되었습니다. 바꾸려면 환경 변수를 수정하고 BaoCut을 다시 시작하세요.',
    shareHint: '다른 앱과 이 폴더를 함께 쓰는 경우, 여기서 모델을 삭제하면 폴더에서 파일이 삭제되어 그 앱에서도 모델을 찾을 수 없습니다.',
    blockedPrefix: '지금은 변경할 수 없습니다:',
    viewTasks: '작업 보기',
    changeTitle: '모델 폴더 변경',
    restoreTitle: '기본 위치로 복원',
    restoreLead: '모델 폴더를 다음 위치로 되돌립니다:',
    checking: '이 폴더를 살펴보는 중…',
    cancel: '취소',
    howTo: '기존 모델 처리 방법',
    moveOption: '기존 모델을 그곳으로 이동',
    switchOption: '위치만 전환',
    confirmMove: '이동 후 변경',
    confirmSwitch: '위치 변경',
    movingLabel: '모델 이동 중',
    stayOpen: '그동안 BaoCut을 종료하지 마세요',
    missingDir: '이 폴더가 없습니다(외장 드라이브가 연결되지 않았을 때도 이렇게 표시됩니다). 연결하면 모델을 다시 사용할 수 있으며, 다른 위치를 선택할 수도 있습니다.',
    notWritableDir: 'BaoCut에 이 폴더의 쓰기 권한이 없어 모델을 다운로드할 수 없습니다.',
    loading: '모델 폴더를 읽는 중…',
    pickFailed: (message) => `폴더를 선택하지 못했습니다: ${message}`,
    same: '이미 현재 모델 폴더입니다',
  },
  stats: (used, free, count) =>
    [`${used} 사용 중`, ...(free !== null ? [`디스크 여유 공간 ${free}`] : []), `모델 ${count}개 찾음`].join(' · '),
  blocker: (downloading, testing, tasks) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`${downloading.join(', ')} 다운로드 중`);
    if (testing.length) parts.push(`${testing.join(', ')} 검사 중`);
    if (tasks) parts.push(`작업 ${tasks}개가 로컬 모델 사용 중`);
    return `${parts.join(' · ')}. 모두 끝난 뒤 변경하세요. 그렇지 않으면 사용 중인 파일이 옮겨집니다.`;
  },
  missingTitle: '이 폴더를 찾을 수 없습니다',
  missingText: '이 폴더가 없습니다. 외장 드라이브가 연결되지 않았을 때도 이렇게 표시되니, 연결한 뒤 다시 선택하세요.',
  notWritableTitle: '이 폴더에 쓸 수 없습니다',
  notWritableText:
    'BaoCut에 이 폴더의 쓰기 권한이 없어 모델을 다운로드할 수 없습니다. 쓸 수 있는 위치를 선택하거나 먼저 폴더 권한을 변경하세요.',
  nestedTitle: '여기에 둘 수 없습니다',
  nestedText: '새 위치와 현재 모델 폴더가 서로를 포함합니다(한쪽이 다른 쪽 안에 있음). 현재 폴더 안에 있지도 않고 현재 폴더를 포함하지도 않는 폴더를 선택하세요.',
  found: (count, bytes, free) =>
    `${
      count
        ? `다운로드된 모델 ${count}개(${bytes})를 찾았습니다. 바로 사용할 수 있습니다.`
        : '이 폴더에는 아직 모델이 없습니다. 앞으로 다운로드하는 모델은 여기에 저장됩니다.'
    }${free !== null ? ` 디스크에 ${free} 남아 있습니다.` : ''}`,
  moveNoFit: (required, free, short) =>
    `이동하려면 ${required} 공간이 필요하지만 대상 드라이브에는 ${free}만 남아 있어 ${short} 부족합니다. 옮길 수 없습니다.`,
  moveSameVolume: (size) => `같은 드라이브 안에서 ${size} 분량을 옮기므로 빠릅니다. 이동한 뒤에는 원래 위치에 파일이 남지 않습니다.`,
  moveOther: (size) => `${size} 분량을 옮깁니다. 이동한 뒤에는 원래 위치에 파일이 남지 않습니다.`,
  switchDescription: (count) =>
    `원래 위치의 파일은 삭제하지 않고 그대로 둡니다. 새 위치에 이미 있는 모델${count ? ` ${count}개` : ''}만 사용할 수 있으며, 나머지는 설치되지 않음으로 표시됩니다.`,
  appliedMoving: (where) => `모델을 ${where} 위치로 옮기기 시작했습니다`,
  appliedKept: (where) => `모델 폴더를 ${where} 위치로 변경했습니다 · 원래 위치의 파일은 유지됩니다`,
  applied: (where) => `모델 폴더를 ${where} 위치로 변경했습니다`,
  moveWaiting: (to) => `${to ? `${to} 위치로 ` : ''}이동 시작 대기 중…`,
  moveValidating: (amount) => `복사한 파일 확인 중${amount ? `(${amount})` : ''}…`,
  movePublishing: '이동 마무리 중…',
  moving: (amount, to) => `${to ? `${to} 위치로 ` : ''}${amount ? `${amount} ` : ''}이동 중…`,
};
