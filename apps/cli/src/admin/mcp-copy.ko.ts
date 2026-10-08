import type { McpMessages } from './mcp-copy.ts';

export const ko: McpMessages = {

  previousClientUnknown: '교체된 항목이 쓰던 클라이언트를 식별하지 못해 어떤 클라이언트도 철회하지 않았습니다. baocut mcp status로 기존 클라이언트를 확인하고, 쓰지 않는 클라이언트는 baocut services mcp revoke <clientId>로 철회하세요.',
  defaultProjectRegistered: (name, path) => `BaoCut에 프로젝트가 없어 기본 프로젝트 “${name}”(${path})을 등록했습니다. 외부 Agent는 이 프로젝트에 영상을 만듭니다`,
  help: `사용법:
  baocut mcp install --agent <claude-code|codex|cursor|gemini> [--level ask|auto] [--name <클라이언트 이름>] [--yes]
                                   외부 Agent를 BaoCut의 MCP 서비스에 연결합니다: 서비스를 켜고(Runtime과 함께 시작하도록
                                   설정), 그 Agent용 새 클라이언트와 토큰을 만들고, 주소와 토큰을 Agent의 MCP 설정
                                   (항목 이름 baocut)에 씁니다. 그다음 Agent를 다시 시작하세요
                                   BaoCut에 프로젝트가 없으면 외부 Agent용 CLI 프로젝트를 기본 프로젝트 폴더에 등록합니다
    --level ask|auto               접근 등급: ask는 쓰기와 작업을 BaoCut에서 매번 확인합니다(서비스의 기본값). auto는
                                   바로 실행합니다. 생략하면 현재 등급을 유지합니다
    --name <클라이언트 이름>       BaoCut에 표시할 클라이언트 이름(기본값은 Agent 이름). 따로 철회할 수 있습니다
    --yes                          Agent 설정에 이미 baocut 항목이 있으면 바꾸고, 이전 항목이 쓰던 클라이언트를 철회합니다
                                   (이전 토큰으로 식별. 식별하지 못하면 이름이 같은 클라이언트를 보여 주니 어느 것을
                                   철회할지 직접 정하세요). 없으면 아무것도 덮어쓰지 않고 클라이언트도 만들지 않습니다
  토큰 위치: Claude Code는 ~/.claude/settings.json의 env(BAOCUT_MCP_TOKEN)에 두고 설정에서는 참조만 합니다.
  Codex(~/.codex/config.toml), Cursor(~/.cursor/mcp.json), Gemini CLI(~/.gemini/settings.json)에는 환경 변수를
  둘 곳이 없어 토큰을 설정 파일에 평문으로 씁니다: 이 파일들을 커밋하거나 공유하지 말고 ask 등급을 권장합니다.
  토큰이 유출되면 baocut services mcp revoke <clientId>로 철회하세요.
  서비스는 BaoCut의 Runtime이 실행 중일 때만 쓸 수 있습니다(BaoCut을 열거나 baocut runtime ensure 실행).
  baocut mcp status                MCP 서비스의 상태, 주소, 등급, 클라이언트와 각 Agent 설정에 baocut 항목이
                                   있는지 여부(토큰은 포함하지 않음)`,
  entryExists: (file, entry) => `${file}에 이미 ${entry} 항목이 있어 아무것도 변경하지 않았습니다. 바꾸려면 --yes를 추가하세요`,
  serviceNotAvailable: '이 버전의 BaoCut은 MCP 서비스를 제공하지 않습니다',
  serviceStartFailed: (reason) => `MCP 서비스를 시작하지 못했습니다: ${reason ?? '알 수 없는 이유'}`,
  connected: (host, url) => `${host}을(를) BaoCut의 MCP 서비스에 연결했습니다: ${url}`,
  configEnv: (configFile, envFile, envVar) =>
    `설정: ${configFile}(토큰은 ${envFile}의 env.${envVar}에 있으며 설정에서는 참조만 합니다)`,
  configPlaintext: (configFile, clientId) =>
    `설정: ${configFile}(토큰이 이 파일에 평문으로 저장됩니다: 커밋하거나 공유하지 마세요. 유출되면 baocut services mcp revoke ${clientId} 명령으로 철회하세요)`,
  clientLine: (name, clientId, level) => `클라이언트: ${name}(${clientId})  등급: ${level ?? '—'}`,
  restartHint: (host) =>
    `${host}을(를) 다시 시작하면 적용됩니다. 서비스는 BaoCut의 Runtime과 함께 실행됩니다: Runtime이 실행 중이 아니면 먼저 BaoCut을 열거나 baocut runtime ensure를 실행하세요`,
  replacedRevoked: (name, clientId) => `이전 항목을 바꾸고 그 항목이 쓰던 클라이언트를 철회했습니다: ${name}(${clientId})`,
  replacedRevokeFailed: (reason) => `이전 항목을 바꿨지만 그 항목이 쓰던 클라이언트를 철회하지 못했습니다: ${reason}`,
  oldClientRemains: (ids) =>
    `이전 클라이언트가 아직 남아 있습니다: ${ids.join(', ')}. 더 이상 쓰지 않으면 baocut services mcp revoke <clientId>`,
  sameNameClientsRemain: (ids, unrecognized) =>
    `${unrecognized ? '이전 항목이 어느 클라이언트를 썼는지 식별하지 못했습니다. ' : ''}이름이 같은 클라이언트가 아직 남아 있습니다: ${ids.join(', ')}. 더 이상 쓰지 않으면 baocut services mcp revoke <clientId>`,
  hostsHeading: (entry) => `각 Agent 설정에 ${entry} 항목이 있는지 여부:`,
  hostUnreadable: (problem) => `읽을 수 없음(${problem})`,
  hostConfigured: '있음',
  hostNotConfigured: '없음',
  noServiceStatus: 'Runtime이 MCP 서비스의 상태를 보고하지 않았습니다',
  levelChoice: (value) => `--level은 ask 또는 auto여야 합니다: ${value}`,
};
