import type { SpaceMessages } from './space-copy.ts';

export const zhHant: SpaceMessages = {
  help: `用法：
  baocut space rescan              重新掃描來源資料夾
  baocut space rebuild             從來源資料夾與記錄重建 Space 目錄；
                                   內容索引會在背景重新讀取所有影片
  baocut space trash|restore <entry id>
                                   移到垃圾桶／從垃圾桶回復（不動檔案；影片項目會將影片資料夾
                                   移入／移出垃圾桶）
  baocut space purge <entry id>    永久刪除垃圾桶中的項目；仍有影片或任務在使用時不會刪除，
                                   並列出引用處
  baocut space delete-video <entry id>
                                   刪除影片：將影片資料夾移到垃圾桶，保留期限內可以回復；
                                   連結素材的原始檔案不受影響
  baocut space continue <entry id> [--conversation <session id>]
                                   從項目繼續對話：引用（只含識別碼與中繼資料）會隨下一則訊息附上；
                                   未指定對話時，依項目所在位置選擇一個對話或建立新對話`,
  usage: [
    '用法：baocut space rescan | rebuild | trash <entry id> | restore <entry id> | purge <entry id> | delete-video <entry id>',
    '      baocut space continue <entry id> [--conversation <session id>]',
  ].join('\n'),
  entryUsage: (action) => `用法：baocut space ${action} <entry id>`,
  continueUsage: '用法：baocut space continue <entry id> [--conversation <session id>]',
  flagNotAccepted: (action, key) => `baocut space ${action} 不接受 --${key}`,
  rescanStarted: '已開始重新掃描',
  rebuilt: (entries, pendingVideos) =>
    `已重建目錄：${entries} 個項目；內容索引正在背景重新讀取 ${pendingVideos} 部影片，完成前搜尋結果不完整`,
  purgeBlocked: (id) => `${id} 仍有影片或任務在使用，未刪除`,
  movedToTrash: (id, name) => `已移到垃圾桶：${id}  ${name}`,
  restoredFromTrash: (id, name) => `已從垃圾桶回復：${id}  ${name}`,
  purged: (id) => `已永久刪除 ${id}`,
  notPurged: (id) => `未刪除 ${id}：仍有引用`,
  videoTrashed: (name, entryId, retentionDays) =>
    `已將影片「${name}」移到垃圾桶：${entryId}（可用 baocut space restore ${entryId} 回復${retentionDays === null ? '' : `；${retentionDays} 天後永久刪除`}）`,
  relatedKept: (n) => `由它匯出或產生的 ${n} 個項目會留在原處`,
  continued: (created, id, cwd) => `${created ? '已建立對話' : '使用對話'} ${id}  工作資料夾 ${cwd}`,
  referenceNext: (name, id) => `項目「${name}」的引用會隨下一則訊息附上：baocut chat "…" --conversation ${id}`,
};
