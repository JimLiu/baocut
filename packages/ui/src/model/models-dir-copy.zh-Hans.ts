import type { ModelsDirMessages } from './models-dir-copy.ts';

export const zhHans: ModelsDirMessages = {
  dir: {
    title: '模型目录',
    defaultChip: '默认',
    envChip: '环境变量',
    change: '更改…',
    restore: '恢复默认',
    envNote: '由环境变量 BAOCUT_MODELS_DIR 指定，要改请改环境变量并重启 BaoCut。',
    shareHint: '多个程序共用同一个文件夹时，在这里删除模型会删掉文件夹里的文件，别的程序也会找不到它。',
    blockedPrefix: '现在不能更改：',
    viewTasks: '查看任务',
    changeTitle: '更改模型目录',
    restoreTitle: '恢复默认位置',
    restoreLead: '把模型目录改回',
    checking: '正在查看这个文件夹…',
    cancel: '取消',
    howTo: '现有的模型怎么处理',
    moveOption: '把现有模型移过去',
    switchOption: '只切换位置',
    confirmMove: '移动并更改',
    confirmSwitch: '更改位置',
    movingLabel: '正在移动模型',
    stayOpen: '期间请不要关闭 BaoCut',
    missingDir: '这个文件夹不存在（外置盘没有接上时也会这样）。接好后模型才能用；也可以换一个位置。',
    notWritableDir: 'BaoCut 没有这个文件夹的写入权限，模型下载不进去。',
    loading: '正在读取模型目录…',
    pickFailed: (message) => `没能选择文件夹：${message}`,
    same: '已经是当前的模型目录',
  },
  stats: (used, free, count) => [`已用 ${used}`, ...(free !== null ? [`所在磁盘可用 ${free}`] : []), `已识别 ${count} 个模型`].join(' · '),
  blocker: (downloading, testing, tasks) => {
    const parts: string[] = [];
    if (downloading.length) parts.push(`正在下载 ${downloading.join('、')}`);
    if (testing.length) parts.push(`正在检查 ${testing.join('、')}`);
    if (tasks) parts.push(`${tasks} 个任务在用本地模型`);
    return `${parts.join('，')}。等它们结束后再更改，否则文件会在使用中被搬走。`;
  },
  missingTitle: '找不到这个文件夹',
  missingText: '这个文件夹不存在。外置盘没有接上时也会这样，接好后再选一次。',
  notWritableTitle: '这个文件夹不可写',
  notWritableText: 'BaoCut 没有这个文件夹的写入权限，模型下载不进去。换一个可写的位置，或先改它的权限。',
  nestedTitle: '不能放在这里',
  nestedText: '新位置与当前的模型目录互相包含（一个在另一个里面）。换一个不在它里面、也不包含它的文件夹。',
  found: (count, bytes, free) =>
    `${count ? `发现 ${count} 个已下载的模型（${bytes}），可以直接使用。` : '这个文件夹里还没有模型，之后下载的模型会放在这里。'}${
      free !== null ? ` 所在磁盘可用 ${free}。` : ''
    }`,
  moveNoFit: (required, free, short) => `要移动 ${required}，目标盘只有 ${free} 可用，还差 ${short}，放不下。`,
  moveSameVolume: (size) => `要移动 ${size}，在同一块盘上，很快；移完后原位置不再保留这些文件。`,
  moveOther: (size) => `要移动 ${size}，移完后原位置不再保留这些文件。`,
  switchDescription: (count) => `原位置的文件保留，不删除。只有新位置里已有的${count ? ` ${count} 个` : ''}模型可用，其余显示为未安装。`,
  appliedMoving: (where) => `开始把模型移到 ${where}`,
  appliedKept: (where) => `模型目录已改为 ${where} · 原位置的文件保留`,
  applied: (where) => `模型目录已改为 ${where}`,
  moveWaiting: (to) => `等待开始移动${to ? `到 ${to}` : ''}…`,
  moveValidating: (amount) => `正在校验复制过去的文件${amount ? `（${amount}）` : ''}…`,
  movePublishing: '正在完成移动…',
  moving: (amount, to) => `正在移动${amount ? ` ${amount}` : ''}${to ? ` 到 ${to}` : ''}…`,
};
