import type { NodesMessages } from './nodes-copy.ts';

export const ko: NodesMessages = {
  nodesHelp: (port) => `사용법:
  baocut nodes                     페어링된 LAN 노드 목록(각각 실시간으로 한 번 확인)
  baocut nodes discover            기능을 공유하는 LAN 노드 찾아보기(macOS)
  baocut nodes pair <주소[:포트]> <페어링 코드> [--alias <별칭>]
                                   상대 컴퓨터의 “이 컴퓨터 공유”에 표시된 페어링 코드로
                                   페어링합니다. 포트 기본값은 ${port}
  baocut nodes remove <nodeId|별칭>
                                   이 컴퓨터에 기억된 노드와 토큰을 삭제합니다`,
  noPairedNodes: '페어링된 노드가 없습니다. baocut nodes pair <주소[:포트]> <페어링 코드>로 페어링하세요',
  noNodesDiscovered: '기능을 공유하는 노드를 찾지 못했습니다(찾아보기는 macOS에서만 동작합니다. 주소를 입력해 페어링할 수도 있습니다)',
  pairUsage: '사용법: baocut nodes pair <주소[:포트]> <페어링 코드> [--alias <별칭>]',
  removeUsage: '사용법: baocut nodes remove <nodeId|별칭>',
  paired: (description) => `페어링했습니다: ${description}`,
  noSuchNode: (ref) => `페어링된 노드가 없습니다: ${ref}`,
  removed: (alias, nodeId) => `${alias}(${nodeId}) 항목을 삭제했습니다`,
  invalidPort: (port) => `잘못된 포트: ${port}`,
  shareHelp: (port, capabilities) => `사용법:
  baocut share [status]            “이 컴퓨터 공유” 상태: 주소, 포트, 기능별 스위치,
                                   페어링 코드, 페어링된 컴퓨터
  baocut share start [옵션]        공유를 시작하고 페어링 코드를 만듭니다
    --port <포트>                  기본값 ${port}
    --name <이름>                  다른 사람에게 보이는 이름. 기본값은 호스트 이름
    --allow-any-source             모든 출처 주소를 받습니다(기본값은 LAN 주소만)
  baocut share stop                공유를 중지합니다(다른 사람이 제출한 작업은 취소됨)
  baocut share code                이전 페어링 코드를 무효화하고 새 코드를 만듭니다
  baocut share revoke <clientId>   페어링된 컴퓨터를 철회합니다
  baocut share capability <기능> <on|off>
                                   기능(${capabilities.join(', ')})의 공유를 켜거나 끕니다. 바로 적용됩니다:
                                   끄면 다른 사람의 새 작업은 거부되고, 이미 받은 작업은
                                   끝까지 실행됩니다`,
  portRange: '--port는 0~65535 사이의 정수여야 합니다',
  shareRevokeUsage: '사용법: baocut share revoke <clientId>',
  capabilityLabels: { transcribe: '전사' },
  capabilityUsage: '사용법: baocut share capability <기능> <on|off>(예: baocut share capability transcribe off)',
  shareOff: '꺼짐',
  shareOn: '켜짐',
  shareNotListening: (error: string | null) => `켜져 있지만 수신 대기하지 않음${error ? `: ${error}` : ''}`,
  shareState: (state: string) => `이 컴퓨터 공유: ${state}`,
  name: (name: string, nodeId: string | null) => `이름: ${name}${nodeId ? `(${nodeId})` : ''}`,
  port: (port: number, anySource: boolean) => `포트: ${port}${anySource ? '(모든 출처 주소)' : ''}`,
  addresses: (addresses: string | null) => `주소: ${addresses ?? '(로컬 네트워크 주소 없음)'}`,
  capabilitiesHead: (empty: boolean) => `기능: ${empty ? '없음' : ''}`,
  capabilityLine: (label: string, capability: string, enabled: boolean) =>
    `  ${label}(${capability}): ${enabled ? '켜짐' : `꺼짐(baocut share capability ${capability} on으로 켜기)`}`,
  pairingCode: (code: string, until: string) => `페어링 코드: ${code}(${until}까지 유효)`,
  pairingLocked: (until: string) => `페어링이 ${until}까지 잠겼습니다(baocut share code로 바로 풀 수 있음)`,
  noPairingCode: '페어링 코드: 없음(baocut share code로 만들기)',
  clientsHead: (empty: boolean) => `페어링된 컴퓨터: ${empty ? '없음' : ''}`,
  clientLine: (name: string, clientId: string, pairedAt: string, lastSeenAt: string | null) =>
    `  ${name}  ${clientId}  페어링 ${pairedAt}${lastSeenAt ? `  마지막 접속 ${lastSeenAt}` : ''}`,
  remoteTasks: (running: number, queued: number) => `원격 작업: 실행 중 ${running}개, 대기 중 ${queued}개`,
  unreachable: '연결할 수 없음',
  versionMismatch: '호환되지 않는 프로토콜 버전',
  unpaired: '페어링이 더 이상 유효하지 않음(다시 페어링하세요)',
  available: '사용 가능',
  transcribeReady: (bundles: readonly string[], running: number, queued: number) =>
    `사용 가능 · 모델 ${bundles.length > 0 ? bundles.join(', ') : '없음'} · 실행 중 ${running}개, 대기 중 ${queued}개`,
  transcribeOff: '사용할 수 없음 · 노드에서 전사 공유를 껐습니다(그 컴퓨터에서 켜세요)',
};
