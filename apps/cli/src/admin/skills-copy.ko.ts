import type { SkillsMessages } from './skills-copy.ts';

export const ko: SkillsMessages = {
  skillsHelp: `사용법:
  baocut skills add <폴더>         로컬 Skill 폴더(루트에 SKILL.md가 있는 폴더)를
                                   <BAOCUT_HOME>/skills에 복사합니다. 기본으로 켜져 있습니다
  baocut skills import <출처>      GitHub에서 Skill을 가져옵니다: owner/repo, 저장소 URL 또는
                                   …/tree/<브랜치>/<폴더>. 기본으로 꺼져 있으니 검토한 뒤 켜세요
    --id <id>                      add와 import용: 다른 id를 씁니다(기본값은 폴더 이름에서 만듦.
                                   같은 id가 있으면 거부하며 덮어쓰지 않음)
  baocut skills enable|disable <id>
                                   Skill을 켜거나 끕니다: 다음에 새로 시작하는 Agent 세션부터 적용됩니다
  baocut skills remove <id>        추가했거나 가져온 Skill을 삭제합니다(내장 Skill은 삭제할 수 없고 끌 수만 있음)`,
  added: '추가했습니다',
  imported: '가져왔습니다',
  turnedOn: '켰습니다',
  turnedOff: '껐습니다',
  reviewFirst: (id) => `먼저 내용을 검토한 뒤(baocut skills read ${id}) baocut skills enable ${id} 명령으로 켜세요`,
  takesEffectNextSession: '다음에 새로 시작하는 Agent 세션부터 적용됩니다. 이미 진행 중인 세션은 영향을 받지 않습니다',
  removed: (id, path) => `${id} 항목을 삭제했습니다(${path})`,
  localSource: (path, addedAt) => `로컬 폴더 ${path}(${addedAt})`,
  remoteSource: (url, ref, commit, importedAt) => `${url}(${ref}@${commit}, ${importedAt})`,
  changed: (verb, id, name, enabled, path, source) =>
    `${verb}: ${id}(${name}, ${enabled ? '켜짐' : '꺼짐'}) → ${path}${source ? `\n출처: ${source}` : ''}`,
  idFormat: (flag, value) => `${flag}에는 Skill id(소문자, 하이픈으로 구분, baocut skills 참고)를 지정하세요: ${value}`,

  skillHelp: `사용법:
  baocut skill install [--dir <폴더>]… [--agent agents|claude] [--copy]
                                   외부 에이전트용 BaoCut 스킬(BaoCut 사용법)을 설치합니다. 기본으로
                                   ~/.agents/skills/baocut(Codex 등 에이전트)와 ~/.claude/skills/baocut(Claude Code)에
                                   BaoCut 앱 안의 스킬을 가리키는 심볼릭 링크로 두므로 앱과 함께 업데이트됩니다
    --dir <폴더>                   대신 <폴더>/.agents/skills와 <폴더>/.claude/skills에 설치합니다. BaoCut 프로젝트가
                                   아니어도 되며 여러 번 지정할 수 있습니다
    --agent agents|claude          둘 중 한 곳만: .agents/skills 또는 .claude/skills
    --copy                         링크 대신 복사합니다(복사본은 앱 업데이트를 따라가지 않으니 업데이트하려면 다시 설치)
  baocut skill status              앱의 스킬 버전, 설치된 위치와 각 위치가 최신인지, 터미널의 baocut 명령
  baocut skill remove [--dir <폴더>]… [--agent agents|claude] [--yes]
                                   제거합니다. 링크는 링크만 지우고, 복사본을 지우려면 --yes가 필요합니다.
                                   baocut/에 있는 BaoCut 스킬이 아닌 것은 절대 바꾸거나 지우지 않습니다`,
  installedAt: (path, linkTarget) => `설치함: ${path}${linkTarget ? ` → ${linkTarget}` : ' (복사본)'}`,
  takesEffect: '새 에이전트 세션부터 적용됩니다',
  removedAt: (path) => `제거함: ${path}`,
  removeCopies: (paths) => `${paths.join(', ')}은(는) 복사본입니다. 제거하면 거기서 수정한 내용까지 파일이 삭제됩니다. 삭제하려면 --yes를 붙이세요`,
  unknownAgent: (value) => `--agent에는 agents(.agents/skills) 또는 claude(.claude/skills)를 지정하세요: ${value}`,
  fixHint: '오래되었거나 깨진 설치가 있습니다. baocut skill install(같은 --dir 포함)로 고칠 수 있습니다',
  statusSkill: (version, source, bundled) => `스킬      ${version ?? '?'}  ${source}${bundled ? '' : ' (개발 빌드: Runtime이 생성)'}`,
  statusCli: (entry) => `CLI       ${entry ?? '포함되지 않음(개발 빌드)'}`,
  statusOnPath: (path, target, fromApp) => `터미널    ${path}${target ? ` → ${target}` : ''}${fromApp ? ' (이 앱의 것)' : ' (이 앱의 것이 아님)'}`,
  statusNotOnPath: (command) => `터미널    PATH에 baocut이 없습니다${command ? `. 어느 터미널에서나 쓰려면: ${command}` : ''}`,
  statusAddToPath: (dir) => `터미널    PATH에 baocut이 없습니다. 어느 터미널에서나 쓰려면 ${dir}을(를) 사용자 PATH에 추가하세요`,
  appOutsideApplications: 'BaoCut이 응용 프로그램 폴더 밖에서 실행 중입니다. 앱을 옮기거나 지우면 링크가 끊어집니다',
  globalHeading: '전역',
  state: { none: '설치 안 됨', current: '최신', stale: '오래됨', broken: '깨진 링크', foreign: '다른 항목이 있음(건드리지 않음)' },
  mode: { link: '링크', copy: '복사본' },
};
