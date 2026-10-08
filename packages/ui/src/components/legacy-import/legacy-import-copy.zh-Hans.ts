import type { LegacyImportMessages } from './legacy-import-copy.ts';

export const zhHans: LegacyImportMessages = {
  title: '导入旧版项目？',
  lead: (n) => `这台电脑上有 ${n} 个旧版 BaoCut 的项目。导入后可以在新版里继续编辑，旧文件留在原处，不会改动。`,
  found: '发现的旧版项目',
  destination: '导入到',
  resetDefault: '改回默认',
  change: '更改…',
  pickTitle: '选择导入目录',
  destinationNote: '这个目录会作为一个项目出现在 Home，每个旧版项目是其中的一个视频。',
  hint: '跳过后，下次启动还会再问；勾选「不再提醒」后不再导入。',
  never: '不再提醒',
  skip: '跳过',
  import: '导入',
  importing: (n) => `开始在后台导入 ${n} 个旧版项目`,
  neverDone: '以后不再提醒导入旧版项目，旧文件保持原样',
  skipped: '已跳过，下次启动时再问',
  failed: (message) => `没能导入：${message}`,
};
