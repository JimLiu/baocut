import type { ToolCatalogMessages } from './tool-catalog-copy.ts';

const artifactLabels = { audio: '오디오', image: '이미지', doc: '문서', final: '영상 파일', subtitle: '자막' };

export const ko: ToolCatalogMessages = {
  inputLabels: {
    file: '로컬 파일',
    space: 'Space',
    link: '링크',
    text: '텍스트',
    video: 'Space의 영상',
    document: '문서',
  },
  outputLabels: { video: '영상', artifact: 'Space 항목' },
  artifactLabels,
  tools: {
    transcribe: {
      name: '전사',
      desc: '영상이나 오디오 파일을 전사본과 자막으로 만듭니다. 편집 가능한 영상이면 영상에 기록하고 자막 레이어를 추가합니다',
    },
    'translate-subtitles': {
      name: '자막 번역',
      desc: '자막을 다른 언어로 번역합니다. 전사된 영상이면 번역과 함께 두 언어를 표시할 수 있는 자막 레이어를 추가하며 원문은 그대로 둡니다',
    },
    dub: { name: '번역 더빙', desc: '전사된 영상에 번역으로 새 더빙을 입힙니다. 원래 오디오는 줄이거나 음소거하거나 그대로 둘 수 있습니다' },
    'synthesize-speech': {
      name: '음성 생성',
      desc: '텍스트나 Space의 문서·자막을 소리 내어 읽습니다. 프리셋 목소리를 쓰거나 녹음을 복제하거나 목소리를 설명할 수 있습니다',
    },
    'generate-text': {
      name: '텍스트 생성',
      desc: '필요한 내용을 설명하면 텍스트 모델을 직접 호출해 문구, 대본, 요약을 만듭니다. Space의 문서나 자막을 자료로 첨부할 수 있습니다',
    },
    'generate-image': {
      name: '이미지 생성',
      desc: '그림을 설명하면 클라우드 또는 로컬 이미지 모델로 그립니다. 참조 이미지, 화면 비율, 개수는 선택 사항입니다',
    },
    'link-import': {
      name: '영상 다운로드',
      desc: '링크를 붙여 넣어 영상을 이 컴퓨터에 다운로드합니다. 브라우저 쿠키를 사용할 수 있고, 다운로드한 영상을 전사해 전사본과 자막을 만들 수 있습니다',
    },
    'compress-video': { name: '영상 압축', desc: '목표 크기나 화질로 다시 인코딩합니다. 보내거나 업로드하기 전에 크기를 줄이세요' },
    'merge-video': { name: '영상 합치기', desc: '여러 영상을 순서대로 이어 붙여 하나의 파일로 만듭니다' },
    'extract-audio': { name: '오디오 추출', desc: '화면을 버리고 오디오 트랙만 남깁니다. 일반적인 오디오 코덱은 다시 인코딩하지 않고 그대로 복사합니다' },
  },
  targetNone: '전사본과 자막만 만들기',
  targetCreate: '프로젝트에 영상 만들기',
  subtitleFile: '로컬 자막 파일',
  groups: {
    speech: {
      label: '음성과 자막',
      desc: '전사, 자막 번역, 더빙 추가, 텍스트 읽기. 결과는 문서, 자막, 오디오 항목이며, Space에서 편집 가능한 영상을 선택하면 그 영상에 기록합니다.',
    },
    'text-image': { label: '텍스트와 이미지', desc: '텍스트 모델과 이미지 모델을 직접 호출합니다. 결과는 문서와 이미지 항목입니다.' },
    'video-file': {
      label: '영상 파일',
      desc: '이 컴퓨터의 yt-dlp·ffmpeg 도구로 영상을 다운로드·압축·합치고 오디오를 추출합니다. 결과는 영상 파일과 오디오 항목입니다.',
    },
  },
  artifactItems: (artifacts) => `${artifacts.map((a) => artifactLabels[a]).join(', ') || '결과물'} 항목`,
  resultWritesVideo: '결과: 선택한 영상에 기록',
  resultInSpace: (items) => `결과: Space의 ${items}`,
  resultAlsoCreate: '새 영상도 만들 수 있음',
  resultWritesEditable: '편집 가능한 영상을 선택하면 그 영상에 기록',
  joinResult: (parts) => parts.join(' · '),
};
