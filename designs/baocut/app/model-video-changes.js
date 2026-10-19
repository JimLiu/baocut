/* BaoCut 原型 — 视频的撤销历史（2026-10-19，产品设计 §5.1、§5.5）
   window.BC_VIDEO_CHANGES。纯函数，无 React、无 DOM。

   视频栏只有一个「历史」按钮：对话框里「版本」是版本记录（model-video-versions.js），「修改」是这里的撤销历史——
   每笔提交是一个修订，新的在前，可以单独撤销其中一笔。真实界面读 `videos.history`（至多 100 笔）。
   原型没有事务表，从版本记录的演示数据展开：每个版本的动作按次数拆成一笔一笔，修订号从这一版结束时往回数，
   时间落在它的起止之间。撤销历史从重建开始（视频格式规范 §9.7），所以展开到重建版本为止。
   原型里撤销只改这份列表，不改时间线上的内容。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const LIMIT = 100;

  /** 保存版本只建检查点，重建没有修改内容：这两种版本里的那一笔不给撤销。 */
  const FIXED = new Set(['save', 'rebuild']);

  /** 版本记录的状态（新的在前）→ 撤销历史（新的在前）。 */
  function fromVersions(st, names) {
    const VV = root.BC_VIDEO_VERSIONS;
    const out = [];
    for (const v of st.versions) {
      if (v.kind === 'rebuild') break;
      if (v.unreadable) continue;
      const steps = [];
      v.actions.forEach((a) => { for (let i = 0; i < a.count; i += 1) steps.push(a); });
      steps.reverse().forEach((a, i) => {
        const share = steps.length > 1 ? i / (steps.length - 1) : 0;
        out.push({
          id: `${v.n}.${i}`,
          rev: Math.max(1, v.revs[1] - i),
          label: a.label,
          actor: VV.actorLabel(a.actor, names),
          min: v.end + (v.start - v.end) * share,
          undoAvailable: !FIXED.has(v.kind),
          undone: false,
        });
      });
      if (out.length >= LIMIT) break;
    }
    return out.slice(0, LIMIT);
  }

  /** 单独撤销一笔：它标「已撤销」，撤销本身是新的一笔，记在最上面（命令协议规范 `edits.undo` 的 `target: { transaction }`）。 */
  function undo(list, id) {
    const hit = list.find((e) => e.id === id);
    if (!hit || hit.undone || !hit.undoAvailable) return list;
    const top = list[0];
    const entry = {id: `undo:${id}`, rev: top.rev + 1, label: `撤销：${hit.label}`, actor: '你', min: 0, undoAvailable: false, undone: false};
    return [entry].concat(list.map((e) => (e.id === id ? Object.assign({}, e, {undone: true}) : e))).slice(0, LIMIT);
  }

  /** 每笔下面那一行：「修订 327 · 你 · 3 分钟前」。 */
  function meta(e) {
    return `修订 ${e.rev} · ${e.actor} · ${root.BC_VIDEO_VERSIONS.agoText(e.min)}`;
  }

  root.BC_VIDEO_CHANGES = {LIMIT, fromVersions, undo, meta};
})();
