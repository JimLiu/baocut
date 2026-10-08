import type { StageMediaMessages } from './stage-media-copy.ts';

export const ko: StageMediaMessages = {
  titles: {
    missing: '원본 파일을 찾을 수 없습니다',
    changed: '원본 파일이 변경되었습니다',
    'outside-project': '원본 파일이 프로젝트 폴더 밖에 있습니다',
    unplayable: '원본 파일을 재생할 수 없습니다',
  },
  causes: {
    missing: '파일이 이동, 이름 변경 또는 삭제되었거나, 연결이 끊긴 드라이브에 있을 수 있습니다.',
    changed: '이 위치의 파일은 더 이상 가져올 때의 파일이 아닙니다(크기가 일치하지 않음). 덮어쓰였거나 다시 내보내졌을 수 있습니다.',
    'outside-project': '기록된 위치가 이 영상이 있는 프로젝트 폴더 밖에 있으며, BaoCut은 그곳의 파일을 읽지 않습니다.',
  },
  unplayable: (error: string) => `플레이어가 이 파일을 열 수 없습니다: ${error}.`,
  tail: {
    video: '자막은 계속 재생되며, 화면과 원본 소리만 나오지 않습니다.',
    audio: '자막은 계속 재생되며, 이 오디오만 들리지 않습니다.',
  },
  body: (cause: string, tail: string) => `${cause} ${tail}`,
  volume: (volume: string) => `파일이 “${volume}” 드라이브에 있습니다. 그 드라이브를 연결하면 자동으로 복구됩니다.`,
  more: (count: number) => `다른 영상 또는 오디오 소재 ${count}개도 재생할 수 없습니다.`,
  relinkHint: '원본 파일을 선택하면 복구됩니다. BaoCut이 내용을 확인하며, 내용이 다른 파일은 다시 연결할 수 없습니다.',
  desktopOnly: '복구하려면 BaoCut 데스크톱 앱에서 이 영상을 열고 캔버스의 “다시 연결…”로 원본 파일을 선택하세요.',
  managed: '이 파일은 영상 폴더에 저장되어 있어 다른 위치로 다시 연결할 수 없습니다.',
  oldRevision: '타임라인이 이 소재의 이전 버전을 사용합니다. 현재 버전만 다시 연결할 수 있습니다.',
  relink: '다시 연결…',
  relinking: '확인 중…',
  pickTitle: (name: string) => `“${name}” 찾기`,
  pickButton: '다시 연결',
  label: (name: string) => `“${name}” 다시 연결`,
  relinkFailed: (message: string) => `다시 연결하지 못했습니다: ${message}`,
  decodeFailed: '디코딩 실패',
  unsupported: '지원하지 않는 형식',
};
