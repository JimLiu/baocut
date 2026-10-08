import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const ko: TextMessages = {
  help: `사용법:
  baocut text <프롬프트> [옵션]    텍스트 모델을 한 번 호출합니다. 프롬프트가 -이면 표준 입력에서 읽습니다. 전체 텍스트는
                                   stdout으로 출력합니다(--out을 지정하면 파일에 쓰고, stdout에는 작업과 결과물의
                                   JSON을 출력). 작업 진행 상황, 경고, 모델 버전은 stderr로 출력합니다
    --system <텍스트>              시스템 메시지
    --json-schema <파일>           구조화된 출력: 이 JSON Schema(루트는 object)에 맞춰 반환하고 검증합니다.
                                   맞지 않으면 작업이 MODEL_OUTPUT_INVALID로 실패합니다
    --provider <id>                openai, google, anthropic 같은 카탈로그 공급자 또는 custom:<이름>.
                                   생략하면 기본값을 씁니다(이 기능에는 내장 기본값이 없음)
    --model <id>                   모델. 생략하면 그 공급자의 기본 모델
    --max-output-tokens <n>        출력 상한. 생략하면 모델의 상한. 잘린 일반 텍스트도
                                   출력하며 output-truncated 경고를 붙입니다
    --effort <${TEXT_EFFORTS.join('|')}>
                                   추론 강도. 모델에 이 단계가 없으면 가장 가까운 단계로, 모델이
                                   조절할 수 없으면 무시합니다(stderr에 설명)
    --temperature <0–2>            지원하는 모델에서만
    --seed <n>                     지원하는 모델에서만
    --out <파일>                   전체 텍스트를 이 파일에 씁니다`,
  stdinPromptHint: '프롬프트를 입력한 뒤 Ctrl-D를 눌러 끝내세요:',
  missingPrompt: '프롬프트가 없습니다',
  jsonSchemaUnreadable: (file, reason) => `JSON Schema ${file}을(를) 읽을 수 없습니다: ${reason}`,
  jsonSchemaNotObject: '--json-schema 파일에는 JSON 객체가 있어야 합니다',
  singleModel: 'text에는 --model을 하나만 지정할 수 있습니다',
  maxOutputTokensInvalid: '--max-output-tokens는 양의 정수여야 합니다',
  effortChoices: (efforts) => `--effort는 ${efforts.join(', ')} 중 하나여야 합니다`,
  temperatureRange: '--temperature는 0~2 사이여야 합니다',
  seedInvalid: '--seed는 정수여야 합니다',
  noTextResult: '작업은 끝났지만 텍스트 결과가 없습니다',
  fetchOutputFailed: (artifactId, status) => `결과물 ${artifactId}을(를) 가져오지 못했습니다: HTTP ${status}`,
  written: (file) => `${file}에 썼습니다`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `, 입력 ${usage.input} / 출력 ${usage.output} 토큰` : ''}`,
};
