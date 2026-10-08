import type { SpaceMessages } from './space-copy.ts';

export const ko: SpaceMessages = {
  help: `사용법:
  baocut space rescan              소스 폴더를 다시 스캔합니다
  baocut space rebuild             소스 폴더와 기록으로 Space 카탈로그를 다시 만듭니다.
                                   콘텐츠 색인은 백그라운드에서 모든 영상을 다시 읽습니다
  baocut space trash|restore <항목 id>
                                   휴지통으로 옮기기 / 휴지통에서 복원(파일은 건드리지 않음.
                                   영상 항목은 영상 폴더가 휴지통으로 들어가거나 나옴)
  baocut space purge <항목 id>     휴지통의 항목을 영구 삭제합니다. 영상이나 작업이 아직 쓰고
                                   있으면 삭제하지 않고 참조를 보여 줍니다
  baocut space delete-video <항목 id>
                                   영상을 삭제합니다: 영상 폴더를 휴지통으로 옮기며 보관 기간 안에는
                                   복원할 수 있습니다. 링크된 소재의 원본 파일은 건드리지 않습니다
  baocut space continue <항목 id> [--conversation <세션 id>]
                                   항목에서 세션을 이어 갑니다: 참조(식별자와 메타데이터만)가 다음 메시지와 함께
                                   전달됩니다. 세션을 지정하지 않으면 항목 위치에 따라 고르거나 새로 만듭니다`,
  usage: [
    '사용법: baocut space rescan | rebuild | trash <항목 id> | restore <항목 id> | purge <항목 id> | delete-video <항목 id>',
    '        baocut space continue <항목 id> [--conversation <세션 id>]',
  ].join('\n'),
  entryUsage: (action) => `사용법: baocut space ${action} <항목 id>`,
  continueUsage: '사용법: baocut space continue <항목 id> [--conversation <세션 id>]',
  flagNotAccepted: (action, key) => `baocut space ${action}에는 --${key} 플래그를 쓸 수 없습니다`,
  rescanStarted: '다시 스캔을 시작했습니다',
  rebuilt: (entries, pendingVideos) =>
    `카탈로그를 다시 만들었습니다: 항목 ${entries}개. 콘텐츠 색인이 백그라운드에서 영상 ${pendingVideos}개를 다시 읽고 있어 끝날 때까지 검색 결과가 불완전합니다`,
  purgeBlocked: (id) => `${id} 항목은 아직 영상이나 작업에서 쓰고 있어 삭제하지 않았습니다`,
  movedToTrash: (id, name) => `휴지통으로 옮겼습니다: ${id}  ${name}`,
  restoredFromTrash: (id, name) => `휴지통에서 복원했습니다: ${id}  ${name}`,
  purged: (id) => `${id} 항목을 영구 삭제했습니다`,
  notPurged: (id) => `${id} 항목을 삭제하지 않았습니다: 아직 참조되고 있습니다`,
  videoTrashed: (name, entryId, retentionDays) =>
    `영상 “${name}”을(를) 휴지통으로 옮겼습니다: ${entryId}(baocut space restore ${entryId} 명령으로 복원${retentionDays === null ? '' : `. ${retentionDays}일 후 영구 삭제`})`,
  relatedKept: (n) => `이 영상에서 내보내거나 생성한 항목 ${n}개는 그대로 둡니다`,
  continued: (created, id, cwd) => `${created ? '세션을 만들었습니다' : '세션 사용'} ${id}  작업 폴더 ${cwd}`,
  referenceNext: (name, id) =>
    `항목 “${name}”의 참조가 다음 메시지와 함께 전달됩니다: baocut chat "…" --conversation ${id}`,
};
