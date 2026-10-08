/* 项目库：归档只是可恢复的整理标记；克隆建立独立项目，不继承正在运行的工作。
   原型只复制内存中的项目数据；真实项目包的一致性快照由内核负责。 */
(function () {
  function visible(projects, archived) {
    return (projects || []).filter((p) => !!p.archived === !!archived);
  }

  function setArchived(projects, id, archived) {
    return projects.map((p) => p.id === id ? {...p, archived: !!archived} : p);
  }

  function cloneTitle(projects, title) {
    const base = `${String(title || '未命名视频')} 副本`;
    const names = new Set(projects.map((p) => p.title));
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
    return name;
  }

  function clone(projects, id, newId) {
    const source = projects.find((p) => p.id === id);
    if (!source || !newId || projects.some((p) => p.id === newId)) return null;
    const copy = JSON.parse(JSON.stringify(source));
    Object.assign(copy, {id: newId, title: cloneTitle(projects, source.title),
      archived: false, modified: '刚刚', mtime: 0, otime: 0, ctime: 0});
    // 运行中的进度与失败属于原任务，不能让新副本冒出不存在的后台任务。
    if (['transcribing', 'queued', 'error'].includes(copy.status)) {
      copy.status = copy.content?.paras?.length ? 'complete' : 'ready';
    }
    ['progress', 'queuePos', 'error', 'taskId', 'jobId', 'sessionId', 'archivedAt', 'toast'].forEach((key) => delete copy[key]);
    return copy;
  }

  Object.assign(window, {BC_LIBRARY: {visible, setArchived, cloneTitle, clone}});
})();
