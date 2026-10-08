import type { ExportSettingsMessages } from './export-settings.ts';

export const ko: ExportSettingsMessages = {
  quality: { small: '작은 파일', standard: '표준', high: '고화질' },
  qualityNote: {
    small: '더 강하게 압축 · 디테일이 약간 줄고 파일이 작아짐',
    standard: '기본 화질과 크기',
    high: '디테일이 더 많고 파일이 커짐',
  },
  loudnessOn: (lufs: string, truePeak: string) => `전체 믹스를 ${lufs} LUFS로 정규화하고 트루 피크가 ${truePeak} dBTP를 넘지 않게 합니다.`,
  loudnessOff: '끔: 영상의 믹스를 그대로 내보냅니다.',
  audioFormatNote: {
    wav: '무손실 · 파일이 가장 큼 · 후반 작업을 이어서 할 때 사용',
    mp3: '범용 · 팟캐스트 플랫폼, 차량 오디오, 오래된 기기에서 재생 가능',
    m4a: 'AAC · 같은 비트레이트에서 MP3보다 조금 더 깨끗함 · Apple 기기 기본 지원',
  },
  dubGroup: (language: string | null) => (language ? `${language} 더빙` : '이 더빙 그룹'),
  mix: '최종 믹스',
  mixNote: '지금 타임라인에서 들리는 것과 같음',
  originalOnly: '원본 오디오만',
  originalOnlyNote: '모든 더빙을 빼고, 더빙 때문에 음소거된 원본 오디오를 되살림',
  dubOnly: (label: string) => `${label}만`,
  dubOnlyNote: '이 더빙 그룹만 남기고 원본 오디오, 음악, 다른 더빙은 뺌',
  mono: '모노',
  stereo: '스테레오',
  subtitleFormatNote: {
    srt: '범용: 거의 모든 플레이어와 플랫폼에서 사용 가능',
    vtt: '웹 플레이어용, 위치 힌트 포함',
    ass: '자막 스타일(글꼴, 외곽선, 위치) 유지, 지원하는 플레이어가 적음',
    json: '항목마다 단어 단위 타임스탬프 포함, 스크립트와 도구용',
  },
  transcription: '전사본',
  plainText: '일반 텍스트',
  transcriptFormatNote: {
    md: '문서 앞 메타 정보를 넣을 수 있고 챕터는 소제목, 화자는 굵게, 번역은 인용으로 씁니다 · 노트나 문서에 붙여 넣기',
    txt: '서식 기호 없음 · 챕터 제목은 따로 한 줄',
  },
};
