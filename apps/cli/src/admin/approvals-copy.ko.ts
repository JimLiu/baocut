import type { ApprovalsMessages } from './approvals-copy.ts';

export const ko: ApprovalsMessages = {
  help: `사용법:
  baocut approvals                 대기 중인 승인 목록 보기(세션과 외부 서비스에서 온 것)
  baocut approvals allow <id>      대기 중인 승인을 허용합니다. 데이터를 공유하는 승인은
                                   기본적으로 이번 한 번만 허용합니다(금액 알 수 없음)
    --persist                      지속 허가도 함께 발급합니다(같은 데이터 공유를 다시 묻지 않음)
    --scope <video|all>            지속 허가의 범위: 이번 호출의 영상(기본값) 또는 모든 영상
    --max-calls <n>                지속 허가의 호출 횟수 상한
    --budget <금액> --currency <통화>
                                   지속 허가의 지출 상한(가격 정보가 있는 모델에만 적용,
                                   비용을 추정할 수 없는 호출은 매번 승인이 필요합니다)
    --expires <ISO 시각>           지속 허가의 만료 시각
  baocut approvals deny <id>       대기 중인 승인을 거부합니다`,
  persistNeedsAllow: '--persist는 allow와 함께만 쓸 수 있습니다',
  alreadyResolved: (id) => `승인 ${id}은(는) 이미 처리되었거나 시간이 초과되었거나 취소되었습니다(또는 존재하지 않습니다)`,
  allowed: (id) => `${id} 항목을 허용했습니다`,
  denied: (id) => `${id} 항목을 거부했습니다`,
  unknownMode: (value: string, flags: readonly string[]) =>
    `알 수 없는 접근 모드: ${value}. --mode에는 ${flags.join(', ')} 중 하나를 지정하세요`,
  mode: (label: string, flag: string) => `${label}(${flag})`,
  usage: '사용법: baocut approvals [list | allow <승인 id> | deny <승인 id>]',
  riskLabels: { read: '읽기', edit: '수정', command: '명령', high: '고위험' },
  none: '대기 중인 승인이 없습니다',
  fromSession: (title: string) => `세션 “${title}”`,
  fromService: (serviceId: string, clientName: string) => `서비스 ${serviceId} · ${clientName}`,
  basisMode: (mode: string) => `모드 ${mode}`,
  basisLevel: (level: string) => `등급 ${level}`,
  approvalLine: (a: {
    id: string;
    who: string;
    action: string;
    targets: readonly string[];
    risk: string;
    summary: string;
    basis: string;
    secondsLeft: number | null;
  }) =>
    `${a.id}  ${a.who}  ${a.action}${a.targets.length > 0 ? ` → ${a.targets.join(', ')}` : ''}  [${a.risk}] ${a.summary}(${a.basis}${a.secondsLeft === null ? '' : `, ${a.secondsLeft}초 후 자동 거부`})`,
  runCommand: (command: string) => `명령 실행: ${command}`,
  changeFiles: (files: readonly string[]) => `파일 수정: ${files.join(', ')}`,
  callTool: (tool: string, files: readonly string[]) => `${tool} 호출${files.length > 0 ? `: ${files.join(', ')}` : ''}`,
};
