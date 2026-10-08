import type { HarnessProjectsMessages } from './harness-projects.ts';

export const ko: HarnessProjectsMessages = {
  conversationNotFound: (p) => `세션을 찾을 수 없습니다: ${p.id}`,
  projectNotFound: (p) => `프로젝트를 찾을 수 없습니다: ${p.id}`,
  folderInaccessible: (p) => `폴더가 없거나 접근할 수 없습니다: ${p.dir}`,
  markerReadFailed: (p) => `프로젝트 표시 파일을 읽지 못했습니다: ${p.error}`,
  markerNewer: (p) =>
    `이 프로젝트는 더 새로운 버전의 BaoCut에서 만들어졌습니다(프로젝트 표시 파일 버전 ${p.version}). BaoCut을 업데이트한 뒤 다시 여세요`,
  untitledProject: '제목 없는 프로젝트', recoveredVideos: '복구된 영상',
  createFolderFailed: (p) => `프로젝트 폴더를 만들지 못했습니다: ${p.error}`,
  tooManySameName: '이 이름의 프로젝트 폴더가 너무 많습니다. 다른 이름을 선택하세요',
  markerNotWritable: (p) =>
    `프로젝트 폴더에 쓸 수 없어 프로젝트 표시 파일 .bcut/project.json을 쓰지 못했습니다: ${p.dir}`,
  markerWriteFailed: (p) => `프로젝트 표시 파일을 쓰지 못했습니다: ${p.error}`,
};
