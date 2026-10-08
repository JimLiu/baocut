/* 旧版项目导入的启动询问（2026-10-08 用户要求）。
   Runtime 就绪后发现旧版（v1 / v2）项目、又没有记下决定时，App 问一次：要不要导入（默认导入）、导入到哪、
   跳过时要不要以后不再提醒。设置与密钥的迁移照旧自动进行，不在询问范围内（architecture-design §2.7）。
   原型确认后（2026-10-08）§2.7 已改成先问再导入；实现在 packages/ui/src/components/legacy-import/。

   这一层只算：各平台的默认目录与显示名、回答落成什么记录、启动时要不要问。不碰 DOM。
   - 默认目录是系统「文稿 / 文档」文件夹下的 `BaoCut`：macOS 与 Linux 是 `~/Documents/BaoCut`；Windows 取系统的
     Documents 已知文件夹（可能被 OneDrive 重定向，不硬拼 `%USERPROFILE%\Documents`），演示按 `C:\Users\me\Documents\BaoCut`。
   - 记录（偏好 `legacyImport`）：`{state: 'import', dest}` 已导入；`{state: 'never'}` 跳过并勾了「不再提醒」，以后不再导入。
     跳过但没勾、或直接关掉对话框，什么都不记，下次启动再问。 */
(function () {
  const HOSTS = [{k: 'darwin', label: 'macOS'}, {k: 'win32', label: 'Windows'}];
  const DEFAULT_DEST = {
    darwin: '~/Documents/BaoCut',
    linux: '~/Documents/BaoCut',
    win32: 'C:\\Users\\me\\Documents\\BaoCut',
  };
  /** 「更改…」的演示候选：交互原型按顺序轮换，模拟系统的文件夹选择器 */
  const DEMO_DIRS = {
    darwin: ['~/Documents/BaoCut', '~/Movies/BaoCut', '/Volumes/ExtremeSSD/BaoCut'],
    linux: ['~/Documents/BaoCut', '~/Videos/BaoCut'],
    win32: ['C:\\Users\\me\\Documents\\BaoCut', 'C:\\Users\\me\\Videos\\BaoCut', 'D:\\BaoCut'],
  };
  /** 演示：Runtime 发现的旧版项目（旧标题 · 上次编辑） */
  const DEMO_FOUND = [
    {title: '科浪访谈 · 第 41 期', edited: '3 周前'},
    {title: '周末 vlog · 京都赏枫', edited: '1 个月前'},
    {title: '产品发布会彩排', edited: '1 个月前'},
    {title: '口播 · 三月复盘', edited: '2 个月前'},
    {title: '读书会 · 第 7 次', edited: '3 个月前'},
    {title: '旅行剪辑 · 冰岛环岛', edited: '4 个月前'},
    {title: '课程录屏 · 第 2 讲', edited: '5 个月前'},
    {title: '年会开场短片', edited: '8 个月前'},
  ];

  /** URL 的 `?platform=`（与 image-gen.jsx 同一个参数）→ 主机；缺省 macOS */
  function hostFrom(search) {
    const p = new URLSearchParams(search || '').get('platform') || '';
    return /^windows/.test(p) ? 'win32' : /^linux/.test(p) ? 'linux' : 'darwin';
  }

  const defaultDest = (host) => DEFAULT_DEST[host] || DEFAULT_DEST.darwin;

  function nextDemoDir(host, cur) {
    const list = DEMO_DIRS[host] || DEMO_DIRS.darwin;
    return list[(list.indexOf(cur) + 1) % list.length];
  }

  /** 显示名：POSIX 的家目录缩成 `~`；Windows 原样（那里没有 `~` 的说法），只去掉结尾的分隔符 */
  function label(path, host) {
    const p = String(path || '').trim();
    if (host === 'win32') return p.replace(/[\\/]+$/, '') || defaultDest(host);
    return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/\/+$/, '') || defaultDest(host);
  }

  /** 已经有决定（导入过，或说过不再提醒）就不再问 */
  const decided = (record) => !!record && (record.state === 'import' || record.state === 'never');

  /** 启动时要不要问：发现了旧版项目、且没有决定。原型里「发现」由 `?legacy=1` 或原型开关模拟 */
  function shouldAsk(found, record) {
    return (found || 0) > 0 && !decided(record);
  }
  const demoLaunch = (search) => new URLSearchParams(search || '').get('legacy') === '1';

  /**
   * 回答 → 要记下的偏好（`record: null` 表示不记、下次启动再问）与给人看的一句话。
   * `action`：'import' | 'skip'；`never`：勾了「不再提醒」。关掉对话框按「跳过」算。
   * 勾了「不再提醒」又点「导入」：照常导入——导入完成后本来就不会再问。
   */
  function decide(action, never, dest, count) {
    if (action === 'import') {
      return {record: {state: 'import', dest}, toast: `开始在后台导入 ${count} 个旧版项目`, tone: 'info'};
    }
    if (never) return {record: {state: 'never'}, toast: '以后不再提醒导入旧版项目，旧文件保持原样', tone: 'neutral'};
    return {record: null, toast: '已跳过，下次启动时再问', tone: 'neutral'};
  }

  /** 原型开关上显示的当前记录 */
  function recordText(record, host) {
    if (!decided(record)) return '没有记录';
    return record.state === 'never' ? '不再提醒' : `已导入到 ${label(record.dest, host)}`;
  }

  const api = {HOSTS, DEFAULT_DEST, DEMO_DIRS, DEMO_FOUND, hostFrom, defaultDest, nextDemoDir, label, decided, shouldAsk, demoLaunch, decide, recordText};
  if (typeof window !== 'undefined') window.BC_LEGACY_IMPORT = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
