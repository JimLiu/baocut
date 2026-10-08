import type { SettingsMessages } from './settings-copy.ts';

export const ko: SettingsMessages = {
  help: `사용법:
  baocut settings                  모든 환경설정 목록: 키, 현재 값, 기본값 여부, 한 줄 설명
  baocut settings get <키>         설정의 현재 값을 출력합니다(JSON)
  baocut settings set <키> <값>
                                   설정을 바꿉니다. 값은 JSON으로 해석하며(true, 20,
                                   {"cjk":18,"other":40}), 해석할 수 없으면 문자열로 받습니다.
                                   알 수 없는 키와 올바르지 않은 값은 거부되며 아무것도 저장하지 않습니다
  baocut settings reset <키>       기본값으로 되돌립니다`,
  usage: '사용법: baocut settings [get <키> | set <키> <값> | reset <키>]',
  setUsage:
    '사용법: baocut settings set <키> <값>(값은 JSON으로 해석하며, JSON이 아니면 문자열로 받습니다. 공백이 있는 값은 따옴표로 감싸세요)',
  unknownKey: (key: string, keys: readonly string[]) => `알 수 없는 설정: ${key}. 사용 가능: ${keys.join(', ')}`,
  isDefault: '기본값',
  modified: (defaultValue: string) => `변경됨(기본값 ${defaultValue})`,
  settingRejected: (key, value, description) => `${key}에는 ${value} 값을 쓸 수 없습니다: ${description}`,
};
