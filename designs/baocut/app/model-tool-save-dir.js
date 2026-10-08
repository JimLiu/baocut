/* 工具结果的保存位置（product-design §2.7「页面」第 4 条；architecture §7.9「保存位置」）。
   没有视频的结果都保存到一个目录：设置里的「默认保存位置」（`prefs.saveDir`），没设过时是运行主机的系统下载文件夹；
   每个工具页的「更改…」只改这一次（`override`），不写回设置。这里只算目录与它的显示名，不碰 DOM。 */
(function () {
  const DEFAULT = '~/Downloads';
  /** 设置里的默认保存位置：`prefs.saveDir` 或系统下载文件夹 */
  function setting(prefs) {
    const v = prefs && typeof prefs.saveDir === 'string' ? prefs.saveDir.trim() : '';
    return v || DEFAULT;
  }
  /** 这次运行实际用的目录：页面上「更改…」选过的优先，否则是设置 */
  function current(prefs, override) {
    const o = typeof override === 'string' ? override.trim() : '';
    return o || setting(prefs);
  }
  /** 是否还是系统默认（设置行上的「默认」标记） */
  const isDefault = (prefs) => setting(prefs) === DEFAULT;
  /** 显示名：家目录缩成 `~`，只留最后两级，太长时中间省略 */
  function label(path) {
    const p = String(path || '').replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/\/+$/, '');
    if (!p) return DEFAULT;
    const parts = p.split('/');
    return parts.length > 3 ? `${parts[0]}/…/${parts.slice(-2).join('/')}` : p;
  }
  const api = {DEFAULT, setting, current, isDefault, label};
  if (typeof window !== 'undefined') window.BC_SAVE_DIR = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
