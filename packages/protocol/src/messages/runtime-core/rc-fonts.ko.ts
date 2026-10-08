import type { RcFontsMessages } from './rc-fonts.ts';

export const ko: RcFontsMessages = {
  manageOnlyInAppOrCli: '글꼴 다운로드, 삭제, 확인은 데스크톱 앱이나 CLI에서만 할 수 있습니다',
  catalogueInvalid: '글꼴 카탈로그의 형식이 잘못되었습니다',

  remedyNetwork:
    '네트워크에 연결할 수 없거나 다운로드가 중단되었습니다. 네트워크를 확인하고 다시 다운로드하거나 설정 › 글꼴의 “스타일시트 주소”와 “글꼴 파일 주소”에서 미러를 바꾸세요',
  remedySource: '글꼴 서비스에서 이 글꼴의 파일을 제공하지 않았습니다. 패밀리 이름과 굵기, 또는 설정의 미러 주소를 확인하세요',
  remedyIntegrity:
    '다운로드한 파일이 사용할 수 있는 글꼴이 아닙니다(패밀리 이름 불일치, 읽을 수 없음, 너무 큼). 잘못된 파일은 삭제했습니다. 다른 미러로 바꾼 뒤 다시 다운로드하세요',
  remedyNoSpace: 'Runtime Home이 있는 디스크의 공간이 부족합니다. 공간을 확보한 뒤 다시 다운로드하세요',

  diskFullWriting: (p) => `${p.what}을(를) 쓰는 중에 디스크가 가득 찼습니다`,
  sourceHttpStatus: (p) => `글꼴 서비스에서 ${p.what}에 대해 HTTP ${p.status} 상태를 반환했습니다`,
  downloadFailed: (p) => `${p.what} 다운로드 실패: ${p.reason}`,
  overByteLimit: (p) => `${p.what}이(가) ${p.limit}바이트 한도를 초과합니다`,

  downloadCancelled: '글꼴 다운로드가 취소되었습니다',
  cancelled: '다운로드가 취소되었습니다',
  offlineStrict: '엄격한 오프라인 모드에서는 글꼴을 다운로드하지 않습니다',
  autoDownloadOff: '글꼴 자동 다운로드가 꺼져 있습니다(설정 › 글꼴의 “글꼴 자동 다운로드”)',
  downloadFailedOutcome: (p) => `다운로드 실패: ${p.reason}`,
  notInCatalogue: (p) => `글꼴 카탈로그에 “${p.family}” 글꼴이 없습니다`,
  noNeedToDownload: (p) =>
    `“${p.family}” 글꼴은 ${p.bundled ? '앱에 기본 포함되어 있으므로' : '이 컴퓨터에 이미 설치되어 있으므로'} 다운로드할 필요가 없습니다`,
  inUseByExport: (p) => `“${p.family}” 글꼴을 끝나지 않은 내보내기에서 사용 중입니다. 내보내기가 끝난 뒤 삭제하세요`,

  sampleLabel: (p) => `${p.family} 샘플`,
  sampleCss: (p) => `${p.label} 스타일시트`,
  noSampleBlock: (p) => `글꼴 서비스의 응답에 ${p.label}이(가) 없습니다`,
  sampleNotOnHost: (p) => `${p.label}이(가) 설정한 글꼴 파일 호스트에 없습니다`,
  sampleNotUsable: (p) => `다운로드한 ${p.label}은(는) 사용할 수 있는 글꼴이 아닙니다`,

  faceLabel: (p) => `${p.family} ${p.weight}${p.italic ? ' 기울임꼴' : ''}`,
  faceCss: (p) => `${p.label} 글꼴 스타일시트`,
  noFaceBlock: (p) => `글꼴 서비스의 응답에 ${p.label}이(가) 없습니다`,
  faceSplit: (p) => `글꼴 서비스에서 ${p.label}을(를) 문자별 하위 집합으로 나눴으며, BaoCut은 아직 이를 병합할 수 없습니다`,
  faceNotOnHost: (p) => `${p.label} 파일이 설정한 글꼴 파일 호스트에 없습니다`,
  faceNotUsable: (p) => `다운로드한 ${p.label}은(는) 사용할 수 있는 글꼴이 아닙니다`,
  familyMismatch: (p) => `다운로드한 ${p.label}의 패밀리 이름이 일치하지 않습니다`,
};
