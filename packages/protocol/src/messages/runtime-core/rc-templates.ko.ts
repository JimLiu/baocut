import type { RcTemplatesMessages } from './rc-templates.ts';

export const ko: RcTemplatesMessages = {
  builtinConflict: (p) =>
    `ID가 “${p.id}”인 내장 템플릿이 이미 있어 이 사본을 불러오지 않았습니다. ID(폴더 이름)를 바꾼 뒤 다시 추가하세요`,
  templateNotFound: (p) => `템플릿이 없습니다: ${p.id}`,
  fileNotRegistered: (p) => `템플릿 “${p.id}”에 이 파일이 등록되어 있지 않습니다: ${p.file}`,
  dirIsSymlink: '템플릿 폴더가 심볼릭 링크라서 따라가지 않습니다. 템플릿 폴더 자체를 추가하세요',
  duplicateId: (p) => `같은 폴더에 ID가 “${p.id}”인 템플릿이 둘 이상 있어 모두 불러오지 않았습니다`,
  templateInvalid: '템플릿이 올바르지 않아 불러오지 않았습니다',
  unsupportedSchema: '이 버전에서 인식하지 못하는 매니페스트 스키마라서 템플릿을 불러오지 않았습니다',
  missingFile: (p) => `${p.file} 파일이 없습니다`,
  fileOverBytes: (p) => `${p.file} 파일이 ${p.limit}바이트를 초과합니다`,
  fileOverBytesActual: (p) => `${p.file} 파일이 ${p.limit}바이트를 초과합니다(${p.size})`,
  fileNotUtf8: (p) => `${p.file} 파일이 올바른 UTF-8이 아닙니다`,
  fileNotJson: (p) => `${p.file} 파일이 올바른 JSON이 아닙니다`,
  fileEmpty: (p) => `${p.file} 파일이 비어 있습니다`,
  registeredFileMissing: (p) => `등록된 파일이 없습니다: ${p.file}`,
  pathOutsideTemplate: (p) => `경로가 템플릿 폴더 밖을 가리킵니다: ${p.file}`,
  unregisteredFile: (p) => `폴더에 등록되지 않은 파일이 있습니다: ${p.file}`,
  tooManyEntries: (p) => `폴더의 항목이 ${p.limit}개를 초과합니다`,
  noSymlinks: (p) => `심볼릭 링크는 허용되지 않습니다: ${p.path}`,
  notRegularFile: (p) => `일반 파일이 아닙니다: ${p.path}`,
  cannotReadDir: (p) => `템플릿 폴더를 읽을 수 없습니다(${p.code})`,
  notScene: (p) =>
    `“${p.title}”은(는) 작품 예시입니다. 템플릿을 첨부하지 말고 프롬프트를 입력란에 넣어 바로 보내세요`,
  assetNotRegistered: (p) => `템플릿 “${p.id}”에 이 소재가 등록되어 있지 않습니다: ${p.asset}`,
  translationForBaseLanguage: (p: { file: string; language: string }) => `${p.file}은(는) 템플릿 원래 언어(${p.language})와 같습니다. template.json과 prompt.md가 이미 이 언어입니다`,
};
