import type { RcTemplatesMessages } from './rc-templates.ts';

export const ja: RcTemplatesMessages = {
  builtinConflict: (p) =>
    `ID が「${p.id}」の組み込みテンプレートがすでにあるため、このコピーは読み込みませんでした。ID（フォルダ名）を変えてからもう一度追加してください`,
  templateNotFound: (p) => `このテンプレートはありません：${p.id}`,
  fileNotRegistered: (p) => `テンプレート「${p.id}」にこのファイルは記載されていません：${p.file}`,
  dirIsSymlink: 'テンプレートフォルダがシンボリックリンクのため、たどりません。テンプレートフォルダ本体を追加してください',
  duplicateId: (p) => `同じディレクトリ内に ID が「${p.id}」のテンプレートが複数あるため、どれも読み込みませんでした`,
  templateInvalid: 'テンプレートが不正なため、読み込みませんでした',
  unsupportedSchema: 'このバージョンではマニフェストの schema を認識できないため、テンプレートを読み込みませんでした',
  missingFile: (p) => `${p.file} がありません`,
  fileOverBytes: (p) => `${p.file} が ${p.limit} バイトを超えています`,
  fileOverBytesActual: (p) => `${p.file} が ${p.limit} バイトを超えています（${p.size}）`,
  fileNotUtf8: (p) => `${p.file} が有効な UTF-8 ではありません`,
  fileNotJson: (p) => `${p.file} が有効な JSON ではありません`,
  fileEmpty: (p) => `${p.file} が空です`,
  registeredFileMissing: (p) => `記載されたファイルが存在しません：${p.file}`,
  pathOutsideTemplate: (p) => `パスがテンプレートフォルダの外を指しています：${p.file}`,
  unregisteredFile: (p) => `フォルダに記載されていないファイルがあります：${p.file}`,
  tooManyEntries: (p) => `フォルダのエントリが ${p.limit} 個を超えています`,
  noSymlinks: (p) => `シンボリックリンクは使用できません：${p.path}`,
  notRegularFile: (p) => `通常のファイルではありません：${p.path}`,
  cannotReadDir: (p) => `テンプレートフォルダを読み取れません（${p.code}）`,
  notScene: (p) =>
    `「${p.title}」は作品例です：テンプレートを添付せずに、プロンプトをメッセージ欄に入れて送信してください`,
  assetNotRegistered: (p) => `テンプレート「${p.id}」にこの素材は記載されていません：${p.asset}`,
};
