import { revealLabel } from '../../copy.ts';
import type { SpaceMessages } from './space-copy.ts';

export const ko: SpaceMessages = {
  searchPlaceholder: '이름, 파일 또는 영상 속 말 검색',
  searchLabel: 'Space 검색',

  // 列表与菜单
  openVideo: '영상 열기',
  viewInfo: '정보 보기',
  transcribe: { first: '전사…', redo: '다시 전사…', retry: '전사 다시 시도…' },
  info: '영상 세부 정보…',
  view: '보기',
  continue: '세션에서 계속',
  favorite: '즐겨찾기',
  unfavorite: '즐겨찾기에서 제거',
  rename: '이름 변경',
  get reveal() {
    return revealLabel();
  },
  viewTask: '작업 보기',
  trash: '휴지통으로 이동',
  restore: '휴지통에서 복원',
  purge: '영구 삭제',
  clear: '지우기',
  columnMeasure: '길이 또는 크기',
  columnStatus: '상태',
  noValue: '—',
  favorited: '즐겨찾기됨',

  // 工具条
  statusPicker: '상태',
  refreshMenu: '새로 고침',
  rescan: '프로젝트 폴더 다시 스캔',
  rescanHint: '모든 프로젝트와 세션 폴더의 파일을 다시 읽습니다',
  rebuild: '인덱스 다시 만들기',
  rebuildHint: '파생된 카탈로그와 콘텐츠 인덱스를 버리고 다시 만듭니다. 즐겨찾기, 표시 이름, 휴지통은 유지됩니다',
  scanning: '프로젝트 폴더 스캔 중',
  rebuilt: (entries: number, pending: number) =>
    pending > 0
      ? `인덱스를 다시 만들었습니다 · 항목 ${entries}개 · 영상 ${pending}개의 콘텐츠 인덱스는 백그라운드에서 계속 업데이트 중`
      : `인덱스를 다시 만들었습니다 · 항목 ${entries}개`,

  // 新建
  newLabel: '새로 만들기',
  newBlank: '빈 영상 만들기',
  newBlankHint: '전사나 대기 없이 바로 열리는 16:9 빈 영상',
  newFromFile: '파일에서 영상 만들기',
  newFromFileHint: '영상이나 오디오는 Home 입력창에 첨부되어 무엇을 할지 말할 수 있고, 이미지는 바로 타임라인에 놓입니다',
  newFromPackage: '포터블 패키지에서 영상 만들기',
  newFromPackageHint: '다른 곳에서 내보낸 .baocut 파일로, 모든 소재가 안에 들어 있습니다',
  pickPackageTitle: '포터블 패키지 선택',
  pickPackageButton: '열기',
  pickPackageFilter: 'BaoCut 포터블 패키지',
  openPackage: '새 영상으로 열기',
  packageBlocked: (reason: string) => `새 영상으로 열기: ${reason}`,
  packageOpening: (name: string) => `“${name}” 여는 중…`,
  packageOpened: (name: string) => `“${name}” 패키지를 새 영상으로 열었습니다`,
  importAssets: '소재 가져오기',
  importAssetsHint: '파일을 프로젝트 소재로 등록합니다. 프로젝트 밖의 파일은 프로젝트의 imports/에 복사됩니다',
  whichProject: '어느 프로젝트에',
  noProject: '먼저 Home에서 프로젝트 폴더를 여세요',
  pickNotMedia: '영상, 오디오 또는 이미지 파일이 아닙니다',
  createdFromFile: (name: string) => `“${name}” 영상을 만들고 소재를 배치했습니다`,
  createdEmpty: (reason: string) => `영상은 만들었지만 소재를 배치하지 못했습니다: ${reason}`,

  // 导入框（原型 SpaceImport）
  importTitle: '소재 가져오기',
  importProject: '가져올 프로젝트',
  importHint:
    '영상, 오디오 또는 이미지를 선택하세요. 프로젝트 폴더 안의 파일은 그 자리에서 등록되고, 밖의 파일은 프로젝트의 imports/에 복사되며 원본은 그대로 둡니다. 어떤 영상에도 추가되지 않습니다.',
  importPick: '파일 선택…',
  importNoProject: '아직 프로젝트가 없습니다. 먼저 Home에서 프로젝트 폴더를 여세요.',
  importing: '가져오는 중',

  // 查看框
  factSource: '출처',
  factFile: '파일',
  factMeasure: '길이 또는 크기',
  factSize: '파일 크기',
  factStatus: '상태',
  factActivity: '최근 활동',
  factConversation: '출처 세션',
  factGenerated: '생성',
  factVersion: '버전',
  factNote: '메모',
  viewConversation: '출처 세션 보기',
  close: '닫기',
  editBlocked: (reason: string) => `다시 편집: ${reason}`,
  continueBlocked: (reason: string) => `세션에서 계속: ${reason}`,
  version: (frozen: string, current: string | null) =>
    current && current !== frozen ? `영상 버전 ${frozen}, 현재 영상은 ${current}` : `영상 버전 ${frozen}`,
  missingTitle: '이 파일을 찾을 수 없습니다',
  // 卡片角标与列表缩略图的读屏说明（原型 sp-prev__flag）
  missingFile: '파일을 찾을 수 없음',
  missingBody: '항목은 그대로 있습니다. 파일이 돌아오면 상태가 복구됩니다.',
  failedTitle: '생성 실패',
  failedBody: '파일이 만들어지지 않았습니다. 작업 페이지에서 원인을 확인하고 다시 시도하거나, 필요 없으면 지우세요.',
  changedTitle: '이후 원본 영상이 변경됨',
  changedBody: '이 결과물은 이전 버전의 영상에 해당합니다. 계속 사용할 수 있지만 현재 영상을 반영하지 않습니다.',
  reexport: '원본 영상에서 다시 내보내기',
  noPreviewVideo: '영상은 편집기에서 열립니다.',

  // 能力（origin.capability）
  capability: {
    synthesizeSpeech: '더빙',
    generateImage: '이미지 생성',
    generateText: '텍스트 생성',
    export: '내보내기',
  },

  // 动作的结果
  trashed: (name: string) => `휴지통으로 이동함 · ${name}`,
  undo: '실행 취소',
  restored: (name: string) => `복원함 · ${name}`,
  purged: (name: string) => `영구 삭제함 · ${name}`,
  cleared: (name: string) => `지움 · ${name}`,
  renamed: '이름을 변경했습니다',
  continued: (created: boolean, name: string, title: string) =>
    created
      ? `“${name}” 항목을 첨부해 새 세션을 시작했습니다: 할 일을 적은 뒤 보내세요`
      : `“${name}” 항목을 첨부해 “${title}” 세션으로 돌아왔습니다: 할 일을 적은 뒤 보내세요`,
  sourceGone: '원본 영상이 지금 어떤 프로젝트나 세션 폴더에도 없어 열 수 없습니다',
  failed: (what: string, reason: string) => `${what} 실패: ${reason}`,

  // 删除视频（产品设计 §4.9）
  trashVideoTitle: '이 영상을 삭제할까요?',
  trashVideoBody: '영상 폴더 전체가 프로젝트의 휴지통으로 이동하며 복원할 수 있습니다. 연결된 원본 소재는 그대로 남습니다.',
  trashVideoRelated: (n: number) => `이 영상에서 내보내거나 생성한 항목 ${n}개는 Space에 남으며 영상과 함께 삭제되지 않습니다:`,
  trashVideoConfirm: '영상 삭제',

  // 彻底删除
  purgeTitle: '영구 삭제할까요?',
  purgeBody: (name: string) =>
    `“${name}” 항목이 디스크에서 삭제되며 복원할 수 없습니다. 영상이나 실행 중인 작업이 아직 사용 중이면 아무것도 삭제하지 않고 무엇이 사용 중인지 알려 줍니다.`,
  purgeVideoBody: (name: string) =>
    `“${name}” 영상의 폴더 전체가 디스크에서 삭제되며 복원할 수 없습니다. 연결된 원본 소재는 영향을 받지 않습니다.`,
  purgeConfirm: '영구 삭제',
  blockedTitle: '아직 삭제할 수 없음',
  blockedBody: (name: string) => `“${name}” 항목이 아직 사용 중이어서 아무것도 삭제하지 않았습니다:`,
  gotIt: '확인',

  // 改名
  renameTitle: '이름 변경',
  renameLabel: '표시 이름',
  renameHint: (fileName: string) =>
    `Space에 표시되는 이름만 바뀌며 파일 자체는 그대로입니다. 비워 두면 원래 이름(“${fileName}”)으로 돌아갑니다.`,
  save: '저장',

  // 来源视频改过（产品设计 §4.6）
  changedDialogTitle: '원본 영상이 변경되었습니다',
  changedDialogBody: (frozen: string | null, current: string | null) =>
    `이 결과물은 영상 버전 ${frozen ?? '(알 수 없음)'}에 해당하며, 현재 영상은 ${current ?? '(알 수 없음)'}입니다. 현재 작업본이 열립니다.`,
  changedOpenCurrent: '현재 작업본 열기',
  changedFromFrozen: '그 버전에서 계속',
  changedFromFrozenReason:
    '이 내보내기를 만든 버전에서 이어서 작업하는 기능은 아직 없습니다(Runtime에 특정 버전으로 돌아가는 명령이 없음). 현재 작업본을 열고 기록에서 그 버전을 볼 수 있습니다.',

  // 内容命中（架构设计 §5.11）
  hitsTitle: '영상 속 말',
  hitsCount: (n: number) => `일치 ${n}건`,
  hitsSearching: '콘텐츠 인덱스 검색 중',
  hitsNone: '영상 속 말 중 일치하는 것이 없습니다',
  hitsError: (reason: string) => `콘텐츠 인덱스를 검색할 수 없습니다: ${reason}`,
  hitUnopenable: '이 영상은 지금 어떤 프로젝트나 세션 폴더에도 없거나 휴지통에 있어 열 수 없습니다',
  hitSourceClock: '타임라인이 아닌 소재 안에 있는 내용입니다. 영상을 열고 직접 찾아보세요',
  hitStale: '인덱스를 만든 뒤 영상이 변경되어 위치가 정확하지 않을 수 있습니다',
  // 内容命中的过滤与分组（设计稿 page-projects.jsx HitGroup；种类、说话人是合同 space.search 的筛选）
  hitsGrouped: (n: number, videos: number) => `일치 ${n}건 · 영상 ${videos}개`,
  hitKind: '문서 유형',
  hitKindAll: '모든 유형',
  hitSpeaker: '화자',
  hitSpeakerAll: '모든 화자',
  hitSpeakerNone: '이 일치 항목에는 화자가 표시된 것이 없습니다',
  hitsNoneFiltered: '이 유형이나 화자에 일치하는 항목이 없습니다. 다른 것을 선택해 보세요.',
  hitsMore: (n: number) => `${n}건 더 보기`,

  // 页面里的其余文字
  cancel: '취소',
  openForEdit: '열어서 편집',
  newVideo: '새 영상',
  revealUnavailable: '이 파일은 어떤 프로젝트나 세션 폴더에도 없어 표시할 위치가 없습니다',
  sidebarLabel: 'Space 분류',
  kindsHeader: '분류',
  mineHeader: '정리',
  sidebarNote: 'Space는 모든 프로젝트의 영상, 소재, 결과물을 보여 줍니다. 파일은 각 프로젝트 폴더에 그대로 있습니다.',
  all: '전체',
  emptyFiltered: '일치하는 항목이 없습니다',
  emptyTrash: '휴지통이 비어 있습니다',
  emptyFavorite: '아직 즐겨찾기가 없습니다',
  emptyAll: '아직 항목이 없습니다',
  emptyCategory: (label: string) => `아직 ${label} 항목이 없습니다`,
  emptyFilteredBody: '다른 키워드를 시도하거나 프로젝트 및 상태 필터를 지우세요.',
  emptyTrashBody: '휴지통으로 이동한 항목이 여기에 표시됩니다. 복원하거나 영구 삭제할 수 있습니다.',
  emptyBody: '세션에서 Agent에게 요청하면 결과물이 여기에 표시됩니다. “새로 만들기”에서 소재를 가져오거나 Home에서 기존 폴더를 열 수도 있습니다.',
  projectPicker: '프로젝트',
  allProjects: '모든 프로젝트',
  sortPicker: '정렬',
  viewPicker: '보기',
  viewGrid: '그리드',
  viewList: '목록',
  issuesTitle: (n: number) => `폴더 ${n}개가 모두 나열되지 않았습니다`,
  issueTruncated: (detail: string) => `파일이 너무 많아 일부만 나열했습니다: ${detail}`,
  issueUnreadable: (detail: string) => `읽을 수 없음: ${detail}`,
  preparing: 'Space 준비 중…',
  preparingBody: '처음에는 프로젝트 폴더를 스캔해야 하므로 잠시 걸립니다.',
  createIn: (project: string, hint: string) => `“${project}” 프로젝트에 · ${hint}`,
  whichProjectFor: (label: string) => `${label}: 어느 프로젝트에`,
  entryActions: (name: string) => `“${name}” 메뉴`,
  entriesLabel: 'Space 항목',
  columnName: '이름',
  columnKind: '유형',
  columnSource: '출처',
  columnActivity: '최근 활동',
  columnMenu: '메뉴',
  relatedMore: (n: number) => `…총 ${n}개`,
  importSummaryIn: (text: string, project: string) => `${text}(${project})`,
  activityAt: (ago: string, at: string) => `${ago}(${at})`,
  withReason: (reason: string, body: string) => `${reason}. ${body}`,
};
