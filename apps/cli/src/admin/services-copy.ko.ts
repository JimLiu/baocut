import { MCP_DEFAULT_PORT, MODEL_API_DEFAULT_PORT, WEB_DEFAULT_PORT } from '@baocut/protocol';
import type { ServicesMessages } from './services-copy.ts';

export const ko: ServicesMessages = {

  accessLinkVideo: (video) => `로그인하면 영상 ${video}의 편집기가 바로 열립니다`,
  help: `사용법:
  baocut services [status]         외부 서비스: MCP 서비스, 모델 API 서비스, 웹 서비스, LAN 노드의
                                   상태, 주소, 등급, 범위
  baocut services start <서비스>   서비스를 시작합니다(mcp, model-api, web, node)
  baocut services stop <서비스>    서비스를 중지합니다(외부 연결을 끊고 확인 대기 중인 요청을 취소합니다.
                                   이미 제출한 작업은 끝까지 실행됨)
  baocut services configure <서비스> [옵션]
    --port <포트>                  수신 포트(루프백 주소에서만. MCP 기본값 ${MCP_DEFAULT_PORT}, 모델 API 기본값
                                   ${MODEL_API_DEFAULT_PORT}). 포트가 사용 중이면 다른 포트로 바꾸지 않고 오류를 보고합니다
    --level read|ask|auto          read는 읽기 전용, ask는 쓰기, 작업, 생성을 BaoCut에서 매번 확인합니다(기본값),
                                   auto는 바로 실행합니다
    --videos all|<id,…>            모든 영상 또는 이 videoId(쉼표로 구분)만 공개합니다. 범위 밖의 영상은
                                   외부에서 보이지 않습니다(모델 API 서비스에는 범위가 없음)
    --autostart on|off             Runtime과 함께 시작
    --route-online on|off          모델 API 서비스: 사용 중인 온라인 서비스로 요청을 전달합니다(기본값 off, 로컬 모델만)
    --route-nodes on|off           모델 API 서비스: 페어링된 LAN 노드로 전달합니다(기본값 off)
    --route-agent on|off           모델 API 서비스: Agent 공급자로 전달합니다(기본값 off)
    --max-concurrent <n>           모델 API 서비스: 클라이언트별 동시 처리 요청 수(기본값 4). 초과한 요청은 429를 받습니다
    --read-only on|off             web 전용: 브라우저에서 보기만 가능하고 편집, 메시지 전송, 작업 제출은 불가
    --methods default|<메서드,…>   web 전용: 메서드 허용 목록(메서드 이름 또는 <네임스페이스>.*). 기본 집합 안에서만 좁힐 수 있음
  baocut services mcp add-client <이름>
                                   외부 앱용 토큰을 만듭니다(이번 한 번만 표시). 앱마다 하나씩
                                   만들며 각각 따로 철회할 수 있습니다
  baocut services mcp clients      만든 클라이언트 목록(토큰은 포함하지 않음)
  baocut services mcp revoke <clientId>
                                   클라이언트를 철회합니다. 그 토큰은 바로 무효가 됩니다
  baocut services mcp connection [clientId]
                                   주소와 MCP 클라이언트 설정에 붙여 넣을 스니펫을 출력합니다
                                   (토큰 자리에는 자리표시자)
  baocut services model-api add-client|clients|revoke|connection …
                                   모델 API 서비스(로컬 OpenAI 방식 엔드포인트)의 클라이언트. 사용법은 위와 같습니다.
                                   이 토큰과 MCP 토큰은 서로 호환되지 않습니다.
                                   connection은 OPENAI_BASE_URL과 OPENAI_API_KEY 설정 방법을 출력합니다
  baocut services model-api aliases
                                   모델 이름 별칭 목록(기본값은 whisper-1 → 로컬 기본 전사 모델)
  baocut services model-api alias <이름> <기능> <providerId>[/<modelId>]
                                   별칭을 추가하거나 바꿉니다. 모델을 생략하면 그 공급자의 기본 모델을 씁니다
  baocut services model-api unalias <이름>
                                   별칭을 삭제합니다
  baocut services web sessions     브라우저 세션 목록(세션 토큰은 포함하지 않음)
  baocut services web revoke <sessionId>
                                   브라우저 세션을 철회합니다: 그 연결은 바로 끊깁니다`,
  webHelp: `사용법:
  baocut web open [--video <videoId>] [--launch]       웹 서비스를 시작하고(기본 포트 ${WEB_DEFAULT_PORT}) 일회용 접근 링크를 출력합니다. 링크는
                                   한 번만, 2분 동안만 쓸 수 있습니다. --launch는 기본 브라우저에서 코드 없는 로그인
                                   페이지를 열고, 접근 코드는 터미널에만 출력하니 로그인 페이지에 붙여 넣으세요
                                   (코드는 브라우저를 여는 명령의 인수로 전달되지 않음)
                                   --video는 해당 영상을 편집기에서 바로 엽니다(videoId는 baocut videos list에서 확인).`,
  usage:
    '사용법: baocut services [status | start <서비스> | stop <서비스>\n' +
    '       | configure <서비스> [--port <n>] [--level read|ask|auto] [--videos all|<id,…>] [--autostart on|off]\n' +
    '                    [--route-online on|off] [--route-nodes on|off] [--route-agent on|off] [--max-concurrent <n>]\n' +
    '                    [--read-only on|off] [--methods default|<메서드,…>]\n' +
    '       | mcp|model-api add-client <이름> | mcp|model-api clients | mcp|model-api revoke <clientId>\n' +
    '       | mcp|model-api connection [clientId]\n' +
    '       | model-api aliases | model-api alias <이름> <기능> <providerId>[/<modelId>] | model-api unalias <이름>\n' +
    '       | web sessions | web revoke <sessionId>]',
  unknownService: (id, available) => `알 수 없는 서비스: ${id}. 사용 가능: ${available.join(', ')}`,
  addClientUsage: (service) =>
    `사용법: baocut services ${service} add-client <이름>(알아보기 쉬운 이름을 고르세요. 예: ${service === 'mcp' ? 'Claude Desktop' : '자막 도구'})`,
  aliasUsage: (capabilities) =>
    `사용법: baocut services model-api alias <이름> <기능> <providerId>[/<modelId>](기능: ${capabilities.join(', ')})`,
  unknownCapability: (capability, available) => `알 수 없는 기능: ${capability}. 사용 가능: ${available.join(', ')}`,
  onOff: (flag) => `${flag}은(는) on 또는 off여야 합니다`,
  portRange: '--port는 1~65535 사이의 정수여야 합니다',
  levelChoice: (levels) => `--level은 ${levels.join(', ')} 중 하나여야 합니다`,
  videosFormat: '--videos는 all이거나 쉼표로 구분한 영상 ID여야 합니다',
  maxConcurrentRange: '--max-concurrent는 1~64 사이의 정수여야 합니다',
  routingOnlyModelApi: '--route-online, --route-nodes, --route-agent, --max-concurrent는 model-api에만 적용됩니다',
  methodsFormat: '--methods는 default이거나 쉼표로 구분한 메서드 이름과 <네임스페이스>.*여야 합니다',
  webOnlyFlags: '--read-only와 --methods는 웹 서비스에만 적용됩니다',
  nothingToConfigure:
    '변경할 내용이 없습니다: --port, --level, --videos, --autostart, model-api의 라우팅과 동시 요청 수, 또는 web의 --read-only와 --methods를 지정하세요',
  states: {
    off: '꺼짐',
    starting: '시작하는 중',
    on: '켜짐',
    stopping: '중지하는 중',
    error: '오류',
  },
  levels: {
    read: 'read(읽기 전용)',
    ask: 'ask(쓰기를 매번 확인)',
    auto: 'auto(바로 실행)',
  },
  levelAskModelApi: 'ask(생성 요청을 매번 확인)',
  notProvided: (serviceId, label) => `${serviceId}  ${label}  이 버전에서는 제공되지 않음`,
  port: (port) => `포트 ${port}`,
  reason: (error) => `  이유: ${error}`,
  nodeHint: '  포트, 기능, 페어링은 baocut share를 사용하세요',
  autostart: (on) => `  Runtime과 함께 시작: ${on ? '예' : '아니요'}`,
  level: (level) => `  등급: ${level}`,
  levelScope: (level, scope) => `  등급: ${level}  범위: ${scope}`,
  allVideos: '모든 영상',
  someVideos: (ids) => `영상 ${ids.length}개(${ids.join(', ')})`,
  routeLocal: '이 컴퓨터',
  routeOnline: '온라인 서비스',
  routeNodes: 'LAN 노드',
  routeAgent: 'Agent',
  routing: (routes, maxConcurrent) => `  전달 대상: ${routes.join(', ')}  클라이언트별 동시 요청 ${maxConcurrent}개`,
  aliases: (aliases) => `  별칭: ${aliases.length > 0 ? aliases.join(', ') : '없음'}`,
  clientCount: (count) => `  클라이언트: ${count}개`,
  web: (readOnly, methods) =>
    `  읽기 전용: ${readOnly ? '예' : '아니요'}  허용 메서드: ${methods === null ? '기본 집합' : methods.join(', ')}`,
  browserSessions: (count) => `  브라우저 세션: ${count}개(접근 링크: baocut web open)`,
  aliasTarget: (alias, providerId, modelId, capability) => `${alias} → ${providerId}/${modelId ?? '기본 모델'}(${capability})`,
  noAliases: '별칭이 없습니다. baocut services model-api alias <이름> <기능> <providerId>[/<modelId>]로 추가하세요',
  noClients: (service) => `클라이언트가 없습니다. baocut services ${service} add-client <이름>으로 만드세요`,
  client: (clientId, name, createdAt, lastUsedAt) =>
    `${clientId}  ${name}  만든 시각 ${createdAt}  마지막 사용 ${lastUsedAt ?? '없음'}`,
  clientCreated: (name, clientId) => `클라이언트 ${name}(${clientId})을(를) 만들었습니다`,
  tokenOnce: (token) =>
    `토큰(이번 한 번만 표시되니 지금 복사해 저장하세요. 잃어버리면 클라이언트를 철회하고 새로 만드세요): ${token}`,
  address: (url) => `URL: ${url}`,
  bearerHeader: '헤더: Authorization: Bearer <토큰>',
  header: (value) => `헤더: Authorization: ${value}`,
  interfaceVersion: (version) => `인터페이스 버전: ${version}`,
  snippetIntro: '설정 스니펫(토큰 자리표시자를 클라이언트를 만들 때 받은 토큰으로 바꾸세요):',
  noWebSessions: '브라우저 세션이 없습니다. baocut web open으로 접근 링크를 받으세요',
  webSession: (sessionId, createdAt, lastUsedAt, expiresAt, connections) =>
    `${sessionId}  로그인 ${createdAt}  마지막 사용 ${lastUsedAt}  만료 ${expiresAt}  연결 ${connections}개`,
  accessLinkNote: (expiresAt) =>
    `이 링크는 한 번만 쓸 수 있으며 ${expiresAt}까지 유효합니다. 다른 사람에게 공유하지 마세요. 사용했거나 만료되면 baocut web open을 다시 실행하세요`,
  badAccessLink: '접근 링크 형식이 올바르지 않습니다: BaoCut을 업데이트하거나 --launch 없이 다시 실행하세요',
  accessCode: (code) => `접근 코드: ${code}`,
  launchNote: (loginUrl, expiresAt) =>
    `브라우저에 열린 로그인 페이지(${loginUrl})에 이 코드를 붙여 넣으세요. 코드는 한 번만 쓸 수 있으며 ${expiresAt}까지 유효합니다. 다른 사람에게 공유하지 마세요. 사용했거나 만료되면 baocut web open을 다시 실행하세요`,
  webNotStarted: (reason) => `웹 서비스를 시작하지 못했습니다: ${reason}`,
  serviceError: (serviceId, reason) => `${serviceId} 실패: ${reason}`,
  clientRevoked: (clientId) => `${clientId} 항목을 철회했습니다. 그 토큰은 바로 무효가 됩니다`,
  webSessionRevoked: (sessionId) => `${sessionId} 세션을 철회했습니다. 그 연결은 닫혔습니다`,
  browserFailed: (message) => `브라우저를 열지 못했습니다: ${message}. 위의 로그인 페이지를 직접 여세요`,
};
