import type { SpaceMessages } from './space-copy.ts';

export const zhHans: SpaceMessages = {
  help: `用法：
  baocut space rescan              重新扫描来源目录
  baocut space rebuild             从来源目录与记录重建 Space 目录，内容索引在后台重读全部视频
  baocut space trash|restore <条目 id>
                                   移到回收站 / 从回收站恢复（文件不动；视频条目会把视频目录移进 / 移出回收站）
  baocut space purge <条目 id>     彻底删除回收站里的条目；还有视频或任务用着它时不删，列出引用
  baocut space delete-video <条目 id>
                                   删除视频：把视频目录移进回收站，保留期内可以恢复；链接素材的原文件不动
  baocut space continue <条目 id> [--conversation <会话 id>]
                                   从条目继续会话：引用（只有标识与元数据）随下一条消息带上；不给会话时按条目所在选一个或新建`,
  usage: [
    '用法：baocut space rescan | rebuild | trash <条目 id> | restore <条目 id> | purge <条目 id> | delete-video <条目 id>',
    '      baocut space continue <条目 id> [--conversation <会话 id>]',
  ].join('\n'),
  entryUsage: (action) => `用法：baocut space ${action} <条目 id>`,
  continueUsage: '用法：baocut space continue <条目 id> [--conversation <会话 id>]',
  flagNotAccepted: (action, key) => `baocut space ${action} 不接受 --${key}`,
  rescanStarted: '已开始重新扫描',
  rebuilt: (entries, pendingVideos) => `已重建目录：${entries} 条；内容索引在后台重读 ${pendingVideos} 个视频，期间检索结果不完整`,
  purgeBlocked: (id) => `${id} 还有视频或任务用着，没有删除`,
  movedToTrash: (id, name) => `已移到回收站：${id}  ${name}`,
  restoredFromTrash: (id, name) => `已从回收站恢复：${id}  ${name}`,
  purged: (id) => `已彻底删除 ${id}`,
  notPurged: (id) => `没有删除 ${id}：还有引用`,
  videoTrashed: (name, entryId, retentionDays) =>
    `已把视频「${name}」移进回收站：${entryId}（baocut space restore ${entryId} 可以恢复${retentionDays === null ? '' : `，${retentionDays} 天后物理删除`}）`,
  relatedKept: (n) => `由它导出、生成的 ${n} 个条目留在原处`,
  continued: (created, id, cwd) => `${created ? '新建了会话' : '用会话'} ${id}  工作目录 ${cwd}`,
  referenceNext: (name, id) => `条目「${name}」的引用会随下一条消息带上：baocut chat "…" --conversation ${id}`,
};
