import type { ChatMessages } from './chat-copy.ts';

export const ko: ChatMessages = {
  help: `사용법:
  baocut chat <메시지> [옵션]      메시지를 보내고 답장을 출력합니다
    --project <폴더>               이 프로젝트 폴더에서 대화합니다(폴더의 .bcut/project.json으로
                                   프로젝트를 식별하며, 없으면 새로 씁니다)
    --conversation <id>            기존 세션을 이어 갑니다
    --template <id>                장면 템플릿(baocut templates의 scene)을 붙입니다. Runtime이 메시지 뒤에
                                   브리핑 안내와 템플릿 본문을 덧붙입니다. 예시(example)는 붙일 수 없으니
                                   예시의 프롬프트(baocut templates show <id>)를 메시지로 보내세요
    --skill <id>                   Skill을 하나 고릅니다(baocut skills에 있는 것, 꺼져 있어도 됨).
                                   Runtime이 메시지 뒤에 그 SKILL.md 본문을 덧붙입니다
    --mode <ask|auto-accept-edits|auto|full-access|plan>
                                   이 세션의 접근 모드를 바꿉니다(이후 동작은 이 모드를 따름). 생략하면 세션의 모드를
                                   유지하고, 모드를 바꾼 적이 없으면 설정 agent.defaultAccessMode(기본값 auto)를 씁니다
    --yes                          승인 요청을 자동으로 승인합니다(이 세션에서만)`,
  missingMessage: '메시지 내용이 없습니다',
  templateIsExample: (title, id) =>
    `“${title}”은(는) 예시라서 붙일 수 없습니다. baocut templates show ${id} 명령으로 프롬프트를 가져와 메시지로 보내세요`,
  sessionCreated: (id, cwd) => `세션 ${id}  작업 폴더 ${cwd}`,
  disconnected: (reason) => `Runtime과의 연결이 끊어졌습니다: ${reason}`,
  sessionDeleted: '세션이 삭제되었습니다',
  stopping: '중지하는 중…',
  chatTemplate: (id) => `템플릿: ${id}`,
  chatSkill: (id) => `Skill: ${id}`,
  chatMode: (mode) => `접근 모드: ${mode}`,
  taskEnded: (status, error) => `작업: ${status}${error ? ` · ${error}` : ''}`,
  taskStatus: { completed: '완료', stopped: '중지됨', failed: '실패' },
  taskFailed: '작업 실패',
  toolCallFinished: (title, status, exitCode) => `▸ ${title} · ${status}${exitCode !== null ? `(종료 코드 ${exitCode})` : ''}`,
  approvalNeeded: (what) => `승인 필요: ${what}`,
  approvalReason: (isTool, reason) => `${isTool ? '내용' : '이유'}: ${reason}`,
  approvalMode: (mode) => `현재 모드: ${mode}`,
  autoApproved: '자동으로 승인했습니다(--yes)',
  declinedNotTty: '터미널에서 실행 중이 아니어서 거부했습니다(자동으로 승인하려면 --yes를 추가하세요)',
  approvalQuestion: '승인할까요? [y]es / [s]ession / [N]o ',
};
