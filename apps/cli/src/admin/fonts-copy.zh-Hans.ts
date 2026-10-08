import type { FontsMessages } from './fonts-copy.ts';

export const zhHans: FontsMessages = {
  help: `用法：
  baocut fonts [downloaded]        已下载的字体（Google Fonts，按需下载）：族、字重、大小与许可，以及总大小
  baocut fonts search [文字] [--category <分类>] [--script <文字>] [--limit <n>]
                                   选字列表：随应用的、本机的与字体目录里的族，带状态（内置、本机、已下载、可下载、下载中、失败）。
                                   分类：sans-serif、serif、display、handwriting、monospace；文字：chinese、japanese、korean、latin…
  baocut fonts download <族名> [--weights 400,700] [--italic]
                                   下载一个族（默认常规与粗体），进度打到 stderr，Ctrl-C 取消。只发族名与字重；镜像见设置
                                   fonts.cssEndpoint 与 fonts.fileEndpoint，严格离线时拒绝
  baocut fonts remove <族名>       删除这个族下载的字体（还没结束的导出在用时拒绝）
  baocut fonts clear               清空下载的字体（还没结束的导出在用的留下）`,
  alreadyDownloaded: (family) => `「${family}」已经下载好了`,
  downloadDone: '下载完成',
  remedy: (text) => `补救：${text}`,
  usage:
    '用法：baocut fonts [downloaded] | search [文字] [--category <分类>] [--script <文字>] [--limit <n>] | download <族名> [--weights 400,700] [--italic] | remove <族名> | clear',
  listSep: '、',
  categoryChoices: (choices: readonly string[]) => `--category 应为 ${choices.join('、')} 之一`,
  scriptChoices: (choices: readonly string[]) => `--script 应为 ${choices.join('、')} 之一`,
  limitRange: '--limit 应为 1–500 的整数',
  italicNeedsWeights: '--italic 要和 --weights 一起给',
  weightsFormat: '--weights 应为逗号分隔的 1–1000 的字重',
  stateLabels: {
    'built-in': '内置',
    installed: '本机',
    downloaded: '已下载',
    downloadable: '可下载',
    downloading: '下载中',
    failed: '失败',
    unavailable: '不可用',
  },
  face: (weight: number, italic: boolean) => `${weight}${italic ? ' 斜体' : ''}`,
  noDownloads: '还没有下载的字体',
  downloadedTotal: (families: number, faces: number, size: string) => `共 ${families} 个族、${faces} 个字重，${size}`,
  noMatches: '没有符合条件的字体',
  failedWithReason: (state: string, message: string) => `${state}（${message}）`,
  truncated: (total: number, shown: number) => `（共 ${total} 个，只列出前 ${shown} 个）`,
  removed: (count: number, freed: string) => `删除了 ${count} 个字重，释放 ${freed}`,
  nothingToRemove: '没有可删除的字体',
  kept: (count: number, faces: readonly string[]) => `保留 ${count} 个（还没结束的导出在用）：${faces.join('、')}`,
};
