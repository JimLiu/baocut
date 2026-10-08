import type { SpaceActionsMessages } from './space-actions-copy.ts';

export const zhHans: SpaceActionsMessages = {
  edit: {
    video: '打开视频',
    'source-video': '回到来源视频编辑',
    'new-video': '以它为素材新建视频',
    text: '编辑文字',
    version: '另存一份再改',
  },
  trashed: '回收站里的条目要先恢复',
  editGenerating: '还在生成，完成后才能编辑',
  editMissing: '找不到文件：接回文件后才能编辑',
  editFailed: '生成失败，没有可以编辑的文件',
  editPackage: '视频包（便携包）没有二次编辑',
  editText: '还不能在这里另存文字的新版本：在会话中继续，让智能体改',
  editVersion: '图片、音频与模板的手工修改还没有开放：在会话中继续，让智能体改',
  newVideoOutside: '这个文件不在项目或会话的目录里，还不能拿它新建视频',
  packageGenerating: '还在导出，完成后才能打开',
  packageMissing: '找不到这个文件',
  packageFailed: '导出失败，没有可以打开的包',
  packageOutside: '这个包不在项目或会话的目录里，还不能打开',
  continueTrashed: '回收站里的条目要先恢复才能带入会话',
  purgeGenerating: '任务还在进行：先在任务页取消',
  purgeNotTrashed: '先移入回收站，再从回收站里删除',
  referenceKind: {
    'video-asset': '视频素材',
    job: '进行中的任务',
    unverified: '无法确认',
    'user-file': '视频目录里的其他文件',
  },
  importAllFailed: (count: number, error: string) => `${count} 个文件都没有导入：${error}`,
  importFailed: (error: string) => `没有导入：${error}`,
  imported: (count: number) => `已导入 ${count} 个素材`,
  copiedAll: '复制进了项目的 imports/',
  copiedSome: (count: number) => `${count} 个复制进了项目的 imports/`,
  notImported: (count: number) => `${count} 个没有导入`,
  references: (names: readonly string[], total: number) => {
    const quoted = names.map((name) => `「${name}」`).join('');
    return total > 2 ? `Space 条目 ${quoted}等 ${total} 个` : `Space 条目 ${quoted}`;
  },
  referenceOutput: '产物',
};
