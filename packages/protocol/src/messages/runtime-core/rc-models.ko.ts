import type { RcModelsMessages } from './rc-models.ts';

export const ko: RcModelsMessages = {
  offlineStrict: '엄격한 오프라인 모드에서는 모델을 다운로드하지 않습니다',
  sizeChanged: '다운로드할 바이트 수가 바뀌었습니다. 새 계획으로 다시 확인하세요',
  bundleInUse: '모델 패키지를 사용 중입니다. 작업이 끝나거나 취소된 뒤 삭제하세요',
  diarizationNoCheck: '화자 분리 모델 패키지에는 자체 확인이 없습니다. 전사할 때 인식 모델 패키지와 함께 사용됩니다',
  bundleUnavailable: '지금은 모델 패키지를 사용할 수 없습니다',
  installFailed: '모델을 설치하는 중에 문제가 발생했습니다',
  noSuchBundle: (p) => `모델 패키지가 없습니다: ${p.bundleId}`,
  movingDirWait: '모델 폴더를 옮기는 중입니다. 끝난 뒤 다시 시도하세요',
  dirMissing:
    '모델 폴더가 없습니다(외장 드라이브가 연결되지 않았을 때도 이렇게 됩니다). 연결한 뒤 다시 시도하거나 설정에서 다른 모델 폴더를 고르세요',
  selfTestSampleLabel: '인식 확인 샘플',

  workerFailed: (p) => `Worker 실패: ${p.reason}`,
  workerCancelledCheck: 'Worker가 스스로 확인을 취소했습니다',
  noWorkerOutput: 'Worker가 출력을 만들지 않았습니다',
  outputMissing: '출력 파일이 없습니다',
  outputMismatch: '출력 파일의 길이 또는 sha256이 Worker의 응답과 일치하지 않습니다',
  namedOutputMissing: (p) => `출력 파일 ${p.file}이(가) 없습니다`,
  namedOutputMismatch: (p) => `${p.file}의 길이 또는 sha256이 Worker의 응답과 일치하지 않습니다`,
  outputNotJson: '출력이 올바른 JSON이 아닙니다',
  outputNotAsrResult: '출력이 asr-result 계약을 따르지 않습니다',
  transcriptMissingExpected: (p) => `인식된 텍스트에 “${p.expected}” 문구가 없습니다`,
  separationPassed: (p) => `${p.duration}초 · ${p.sampleRate} Hz · 보컬이 배경보다 ${p.finite ? `${p.ratio} dB` : '훨씬'} 높음`,
  speechPassed: (p) => `${p.duration}초 · ${p.sampleRate} Hz`,
  imagePassed: (p) => `${p.width}×${p.height} · ${p.steps}단계`,

  envLocked: '모델 폴더는 BAOCUT_MODELS_DIR 환경 변수로 지정되어 있습니다. 바꾸려면 환경 변수를 변경하고 BaoCut을 다시 시작하세요',
  movingDirWaitOrCancel: '모델 폴더를 옮기는 중입니다. 이동이 끝나거나 취소된 뒤 변경하세요',
  folderMissing: '이 폴더가 없습니다(외장 드라이브가 연결되지 않았을 때도 이렇게 됩니다)',
  folderNotWritable: 'BaoCut에 이 폴더에 쓸 권한이 없습니다',
  dirNested: '새 위치와 현재 모델 폴더가 서로를 포함합니다. 현재 폴더 안에 있지 않고 현재 폴더를 포함하지도 않는 폴더를 고르세요',
  noSpaceForMove: '새 위치의 디스크에 옮길 모델을 담을 공간이 없습니다',
  noSpaceRemedy: '공간을 확보하거나 다른 위치를 고르거나 “위치만 전환”을 선택하세요',
  dirInUse: '작업에서 로컬 모델을 사용 중입니다. 작업이 끝나거나 취소된 뒤 모델 폴더를 변경하세요',
  sourceKept: (p) => `이전 폴더의 저장소 ${p.count}개를 삭제하지 못했습니다. 직접 삭제할 수 있습니다`,
  moveNoSpace: '새 위치의 디스크가 가득 차서 이동을 되돌렸습니다',
  moveFailed: '모델을 옮기는 중에 문제가 발생해 이동을 되돌렸습니다',
  moveFailedRemedy: '원래 모델 폴더는 바뀌지 않았으며 모델은 그대로 사용할 수 있습니다',

  noAlignableFormat: (p) => `모델 ${p.modelId}은(는) 정렬할 수 있는 오디오 형식을 출력하지 않습니다`,
  synthOutputCount: (p) => `음성 합성 출력이 ${p.count}개입니다. 1개여야 합니다`,
  synthOutputOutsideStaging: '음성 합성 출력이 스테이징 폴더에 없습니다',
  dubGrantHint: (p) =>
    `더빙은 전사본(번역, 번역이 없는 부분은 원문)을 ${p.recipient}에 보냅니다. 공급자를 켤 때 만들어지는 기본 허가에는 전사본이 포함되지 않으므로 ` +
    '사용자가 명시적으로 허가를 발급해야 합니다(아래 명령 또는 BaoCut 설정에서). 그런 다음 이 더빙을 다시 실행하세요.',
  voiceRemoved: (p) => `${p.reason}: 목소리 ${p.voice}`,

  notSpeakersJob: '이 작업은 화자 인식이 아닙니다',
  jobNotForVideo: '이 인식은 이 영상에 속하지 않습니다',
  speakersNotDone: '화자 인식이 아직 끝나지 않았습니다',
  speakersCleaned: '인식 결과가 정리되었습니다. 화자를 다시 인식하세요',

  recoveryPrincipalName: '작업 복구',
};
