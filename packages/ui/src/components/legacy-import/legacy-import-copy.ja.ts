import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const ja: LegacyImportMessages = {
  title: '以前のバージョンのプロジェクトを読み込みますか？',
  lead: (n) =>
    `このコンピュータに以前のバージョンの BaoCut のプロジェクトが ${n} 件あります。読み込むと新しいバージョンで編集を続けられます。元のファイルはそのままの場所に残り、変更されません。`,
  found: '見つかったプロジェクト',
  destination: '読み込み先',
  resetDefault: 'デフォルトに戻す',
  change: '変更…',
  pickTitle: '読み込み先を選択',
  destinationNote: 'このフォルダは Home に 1 つのプロジェクトとして表示され、以前の各プロジェクトはその中のビデオになります。',
  hint: 'スキップすると、次回の起動時にもう一度確認します。「今後表示しない」にチェックすると読み込みません。',
  never: '今後表示しない',
  skip: 'スキップ',
  import: '読み込む',
  importing: (n) => `以前のプロジェクト ${n} 件をバックグラウンドで読み込んでいます`,
  neverDone: '以前のプロジェクトの読み込みは今後確認しません。元のファイルはそのままです',
  skipped: 'スキップしました。次回の起動時にもう一度確認します',
  failed: (message) => `読み込めませんでした：${message}`,
};
