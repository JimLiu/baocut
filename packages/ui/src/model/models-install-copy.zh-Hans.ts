import type { ModelsInstallMessages } from './models-install-copy.ts';

const KEEP = '已经下载的部分会留着，下次接着下。';

export const zhHans: ModelsInstallMessages = {
  planSize: (size) => `要下载 ${size}`,
  planSizeEstimate: (size) => `约 ${size}（有文件大小未知，按登记的估计）`,
  amountEstimate: (size) => `约 ${size}`,
  noSpace: (need, have) => `磁盘空间不够：这次要 ${need}，模型目录所在的磁盘只剩 ${have}。先清理出空间再下载。`,
  resumed: (size) => `上次已经下载的 ${size} 接着用，不再重下。`,
  space: (size) => `磁盘可用 ${size}`,
  lineKeep: '已装好，不动',
  lineSize: (size, count) => `${size} · ${count} 个文件`,
  lineUnknown: (count) => `大小未知 · ${count} 个文件`,
  queued: '排队等下载',
  downloading: (amount) => `正在下载 ${amount}`,
  downloadingUnknown: (amount) => `正在下载 · 已收到 ${amount}`,
  verifying: '正在校验与发布',
  pausedKept: (amount) => `已暂停 · 留着 ${amount}，继续时接着下`,
  paused: '已暂停',
  remedyNoSpace: (need, have) => `${need !== null && have !== null ? `这次要 ${need}，只剩 ${have}。` : ''}清理出磁盘空间后再下载；${KEEP}`,
  remedyNetwork: `检查网络后再下载，${KEEP}连不上默认来源时，可以在「设置 › 通用」的「模型下载来源」里换成镜像。`,
  remedyIntegrity: '下载来源给的文件与清单的大小或 sha256 不符，坏的文件已经删掉。换一个下载来源（「设置 › 通用」的「模型下载来源」）后再下载。',
  remedySource: '下载来源没有这个文件或拒绝访问：检查「设置 › 通用」的「模型下载来源」（或环境变量 BAOCUT_MODELS_ENDPOINT）指向的镜像是否完整。',
  remedyManifest: '这个模型包的内置清单缺少可信的 sha256，现在不能安装，要等 BaoCut 更新。',
  remedyOffline: '严格离线模式开着，不下载任何东西。要下载先在设置里关掉严格离线。',
  remedySizeChanged: '要下载的大小变了，按新的计划再确认一次。',
  remedyInUse: '有任务正在用这个模型包（转写、合成、检查或安装）。等它结束，或在后台任务里取消之后再删除。',
  remedyUnavailable: '模型包现在不可用（没装齐、被停用或这台电脑不支持），先修复或重新启用。',
  remedyInstallFailed: `再下载一次试试，${KEEP}`,
  problemText: (message, remedy) => `${message}。${remedy}`,
  removalBody: (unknown, frees, kept) =>
    `${unknown ? '删掉这个模型包独有的文件。' : frees !== null ? `大约腾出 ${frees}。` : ''}${kept
      .map((k) => `${k.repo} 还有 ${k.usedBy.join('、')} 在用，保留。`)
      .join('')}要再用时重新下载。`,
  removed: (bundleId) => `已删除 ${bundleId}`,
  removedKept: (bundleId, repos) => `已删除 ${bundleId} · ${repos.join('、')} 还有别的模型包在用，保留`,
};
