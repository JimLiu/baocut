import type { LibraryMessages } from './library-copy.ts';

export const ko: LibraryMessages = {
  help: `사용법:
  baocut library import <파일>     교환 파일을 가져옵니다. 유형은 확장자가 아니라 내용으로 판별합니다:
                                   Markdown 용어집, .bcvoice 목소리 팩, 브랜드 키트의 색상과 자막 스타일
                                   JSON, Lottie 스티커, 이미지, 영상, 글꼴
  baocut library export <라이브러리> <id> <경로>
                                   현재 버전을 내보냅니다: 용어집은 Markdown, 목소리는 .bcvoice, 브랜드
                                   소재는 원본 파일로 내보냅니다. 대상이 이미 있으면 덮어쓰지 않습니다
  baocut library remove <라이브러리> <id>
                                   항목을 삭제합니다(이미 영상에 복사된 내용은 영향을 받지 않음)
  baocut library voice-clone <목소리 id> --provider <id> [--name <이름>]
                                   목소리의 참조 녹음을 공급자에 업로드해 클론을 만듭니다(현재는 elevenlabs만).
                                   동의 진술과 “audio”를 포함하는 데이터 공유 허가(baocut grants create)가
                                   필요합니다. 작업으로 실행되며 Ctrl-C로 취소합니다
  baocut library voice-clone-remove <목소리 id> --provider <id> [--local-only]
                                   클론을 삭제합니다: 먼저 공급자에 삭제를 요청하고 성공하면 기록을
                                   지웁니다. --local-only는 로컬 기록만 지웁니다
  baocut library video-selection <영상 id> [옵션]
                                   영상에서 사용하는 라이브러리 항목(영상에 저장되며 실행 취소 가능): 옵션이 없으면
                                   보여 줍니다. 지정한 부분은 통째로 바뀌고 나머지는 그대로입니다.
                                   새 영상은 라이브러리에서 “기본으로 사용”으로 표시한 용어집을 자동으로 사용합니다
    --transcribe-glossaries <id,…> 전사용 용어집(전사에 용어집을 지정하지 않았을 때
                                   사용). 빈 문자열이면 비웁니다
    --translate-glossaries <id,…>  번역용 용어집(translate와 dub의 번역에서
                                   사용). 빈 문자열이면 비웁니다
    --speaker-voice <전사본 id>:<화자>=<목소리>[@<Provider>]
                                   화자의 목소리(반복 가능, 통째로 바뀜):
                                   library:<id> 또는 공급자의 목소리 ID(이때는 @Provider를 붙임)
    --clear-speaker-voices         화자의 목소리를 비웁니다`,
  importUsage: '사용법: baocut library import <파일>',
  exportUsage: '사용법: baocut library export <glossaries|voices|brand> <id> <경로>',
  removeUsage: '사용법: baocut library remove <glossaries|voices|brand> <id>',
  voiceCloneUsage: '사용법: baocut library voice-clone <목소리 id> --provider <id> [--name <이름>]',
  voiceCloneRemoveUsage: '사용법: baocut library voice-clone-remove <목소리 id> --provider <id> [--local-only]',
  videoSelectionUsage: '사용법: baocut library video-selection <영상 id> [--translate-glossaries <id,…>] [--speaker-voice …]…',
  imported: (label, id, name) => `${label}에 가져왔습니다: ${id}  ${name}`,
  exported: (id, version, file, bytes) => `${id} 버전 ${version}을(를) ${file}에 내보냈습니다(${bytes}바이트)`,
  deleted: (id) => `${id} 항목을 삭제했습니다`,
  remoteCloneOutcome: {
    deleted: '원격에서 삭제됨',
    'not-found': '원격에 이미 이 목소리가 없음',
    skipped: '원격에 요청하지 않음',
  },
  voiceCloneRemoved: (id, provider, remote) => `${provider}에 있는 ${id}의 클론을 삭제했습니다(${remote})`,
  libraryLabels: { glossaries: '용어집', voices: '목소리', brand: '브랜드 키트' },
  unknownLibrary: (text) => `그런 라이브러리가 없습니다: ${text ?? '(없음)'}. 사용 가능: glossaries, voices, brand`,
  speakerVoiceFormat: (text) => `--speaker-voice의 형식은 <전사본 id>:<화자>=<목소리>[@<Provider>]입니다. 받은 값: ${text}`,
  listSep: ', ',
  none: '(없음)',
  selectionHead: (videoId, documentId, revision) =>
    `영상 ${videoId}${documentId ? `(library-selection 문서 ${documentId} 버전 ${revision})` : '(아직 사용 중인 항목 없음)'}`,
  transcribeGlossaries: (list) => `전사용 용어집: ${list}`,
  translateGlossaries: (list) => `번역용 용어집: ${list}`,
  speakerVoicesNone: '화자의 목소리: (없음)',
  speakerVoice: (documentId, speakerId, voice, providerId) =>
    `화자의 목소리: ${documentId}:${speakerId} = ${voice}${providerId ? `(${providerId}에서만)` : ''}`,
};
