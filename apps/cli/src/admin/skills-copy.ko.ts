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
  baocut skill install --agent <claude-code|codex|cursor|gemini> [--dir <폴더>] [--link] [--yes]
                                   외부 Agent용 BaoCut Skill(BaoCut 사용법)을 호스트의 skills 폴더 안 baocut/에
                                   설치합니다: Claude Code ~/.claude/skills, Codex ~/.codex/skills,
                                   Cursor ~/.cursor/skills, Gemini CLI ~/.gemini/skills
    --dir <폴더>                   다른 skills 폴더를 씁니다(그 아래 baocut/에 설치). --agent가 없으면 필수
    --link                         렌더링한 Skill을 <BAOCUT_HOME>/agent-skills/baocut에 두고 호스트에는 그곳을
                                   가리키는 링크를 둡니다: 나중에 다시 설치하면(어느 호스트든) 모두 함께 업데이트됩니다
    --yes                          대상이 있으면 바꿉니다(링크라면 링크만 바꾸고 링크가 가리키는 폴더는
                                   건드리지 않음). 없으면 아무것도 덮어쓰지 않습니다
  baocut skill path                BaoCut Skill의 출처, 호스트별 설치 위치, 현재 설치된 내용
                                   (Runtime이 필요 없음)`,
  targetExists: (target, linkTarget) =>
    `${target}이(가) 이미 있어(${linkTarget !== null ? `${linkTarget}(으)로 가는 링크` : '폴더 또는 파일'}) 아무것도 변경하지 않았습니다. 바꾸려면 --yes를 추가하세요`,
  installed: (target, files, linkTo) =>
    `BaoCut Skill을 ${target}에 설치했습니다(파일 ${files}개${linkTo ? `, ${linkTo}에 링크` : ''})`,
  takesEffect: (host) => (host ? `새 ${host} 세션에서 적용됩니다` : '새 세션에서 적용됩니다'),
  pathEscapes: (path) => `BaoCut Skill 안의 경로가 폴더 밖을 가리킵니다: ${path}`,
  sourceLine: (dir) =>
    `출처      ${dir ?? '찾을 수 없음(BaoCut이 설치되지 않았고 저장소 안도 아닙니다. BAOCUT_AGENT_SKILLS_DIR 환경 변수를 설정할 수 있습니다)'}`,
  notInstalled: '설치되지 않음',
  linkState: (target) => `링크 → ${target}`,
  installedFolder: '설치됨(폴더)',
  isFile: '파일(Skill 폴더가 아님)',
};
