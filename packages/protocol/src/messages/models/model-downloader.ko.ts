import type { ModelsModelDownloaderMessages } from './model-downloader.ts';

export const ko: ModelsModelDownloaderMessages = {
  remedyNoSpace:
    '모델 폴더가 있는 디스크의 공간이 부족합니다. 충분한 공간을 확보한 뒤(또는 설정에서 모델 폴더를 다른 디스크로 옮긴 뒤) 다시 설치하세요',
  remedyNetwork:
    '네트워크에 연결할 수 없거나 다운로드가 중단되었습니다. 네트워크를 확인하고 다시 설치하세요. 이미 다운로드한 부분은 이어서 받습니다. “설정 › 일반”의 “모델 다운로드 소스”에서 미러를 바꿀 수도 있습니다',
  remedyIntegrity:
    '다운로드한 파일의 크기나 sha256이 매니페스트와 일치하지 않습니다(소스나 미러의 내용이 잘못됨). 잘못된 파일은 삭제했습니다. 다른 다운로드 소스로 바꾼 뒤 다시 설치하세요',
  remedySource:
    '다운로드 소스에 이 파일이 없거나 접근이 거부되었습니다. “설정 › 일반”의 “모델 다운로드 소스”에 설정한 미러(또는 BAOCUT_MODELS_ENDPOINT 환경 변수)가 완전한지 확인하세요',
  remedyManifestIncomplete:
    '이 모델 번들의 기본 제공 매니페스트에 신뢰할 수 있는 sha256이 없어 설치할 수 없습니다. BaoCut 업데이트를 기다리세요',
  downloadFailed: (p: { file: string; reason: string }) => `${p.file} 파일을 다운로드하지 못했습니다: ${p.reason}`,
  integrityMismatch: (p: { file: string }) => `${p.file} 파일의 크기나 sha256이 매니페스트와 일치하지 않습니다`,
  sourceHttp: (p: { file: string; status: number }) =>
    `다운로드 소스가 ${p.file} 파일 요청에 HTTP ${p.status} 응답을 반환했습니다`,
  diskFull: '모델 파일을 쓰는 중에 디스크가 가득 찼습니다',
};
