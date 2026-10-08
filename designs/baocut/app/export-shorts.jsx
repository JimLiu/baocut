/* 导出弹层里的 Shorts 两件 —— 设计稿 docs/design/video/bcut-shorts-design.md §5.6 / §6.3（2026-09-27）。
   ============================================================================
   · `ExportShortsCheck`：视频页顶部的「发布前检查」。导出画幅是 9:16、或项目按 Shorts 交付
     （`delivery: 'shorts'`）时才露出。九行的顺序、规则 id 与五态闭集就是 `bcut shorts check` 那一份
     （契约 3，`BC_SHORTS.checkRows`）；每行一个状态点，能指到地方的那几行是按钮，点了跳过去。
     原型没有渲染器也量不了音频：首帧、循环一律「暂时查不了」；响度只印上次导出成片的**实测值**，
     状态恒为「仅供参考」，不写任何目标数（D4）。
   · `ExportShortsPreset`：「Shorts 快捷设置」一行——一次选好 1080×1920、30 fps、H.264、源语言字幕
     烧入、另存第 0 帧 PNG 封面。只组合现有选项；源裁成竖屏不到 1080 时分辨率照旧落回原始档。

   检查的输入在这里从编辑器上下文拼（`shortsInput`）：字幕块用轨上的锚线 / 字号 / 宽度按输出画面算
   （与 Shorts 字幕预设落位同一份几何，`BC_SHORTS.subBlock`）；可读文字元素（文字 / 文本组 / 计时）按
   各自的 pose 落在项目画面上，再经 `X.cropRect` 映射到输出画面——没写高度的按宽 × 0.22 估。
   模板层（`tplDoc`）不查：平台款模板本来就按同一组安全区数摆（model-shorts.test.js 对拍）。
   ============================================================================ */
(function () {
  const {useMemo} = React;
  const S = window.BC_SHORTS;
  const X = window.BC_EXPORT;
  const L = window.BC_LAYOUT;
  const P = window.BC_POSE;

  /** 可读文字元素：这几类画面上是字 */
  const TEXT_KINDS = {text: true, textgroup: true, counter: true};
  const TEXT_ASPECT = 0.22;          // 没写高度时的高宽比（同 export-preview.jsx 的缺省）

  /** 从编辑器上下文拼 `checkRows` 的输入。 */
  function shortsInput(ctx, {ratio, span, eff, app}) {
    const off = X.offKeys(eff);
    const srcR = L.ratioValue(ctx.ratio);
    const outR = L.ratioValue(ratio);
    const crop = X.cropRect(srcR, outR);
    const subTracks = window.BC_SUB.tracks(ctx.subStyle).map((t) => ({
      id: t.id, name: t.name, role: t.role, y: t.y, valign: t.valign, size: t.size, width: t.width, lh: t.lh,
      on: !t.hidden && !off['subs:' + t.id]}));
    const texts = (ctx.elements || [])
      .filter((e) => TEXT_KINDS[e.kind] && !off['el:' + e.id] && !(ctx.elDocs[e.id] && ctx.elDocs[e.id].hidden))
      .map((e) => {
        const pose = P.poseOf(ctx.elDocs[e.id]);
        const k = pose.scale || 1;
        const w = pose.w * k;
        const h = pose.h != null ? pose.h * k : w * TEXT_ASPECT * srcR;
        const b = {x: pose.x - w / 2, y: pose.y - h / 2, w, h};
        return {id: e.id, label: e.name || e.id, start: e.start || 0, end: e.end,
          box: {x: crop.left + b.x * crop.width / 100, y: crop.top + b.y * crop.height / 100,
            w: b.w * crop.width / 100, h: b.h * crop.height / 100}};
      });
    /* 响度：只读**已导出成片的实测值**（任务记录里的 `measured`），最近一条；没有就是 skip */
    const done = (app.tasks || []).filter((t) => t.kind === 'export' && t.project === ctx.proj.id && t.status === 'done' && t.measured);
    const last = done[0];
    const loudness = last ? {lufs: last.measured.lufs, tp: last.measured.tp,
      file: last.artifacts && last.artifacts[0] ? last.artifacts[0].name : null} : null;
    return {ratio, span, cues: ctx.cues, subTracks, texts,
      loop: !!(ctx.proj.brief && ctx.proj.brief.loop), loudness};
  }

  function ExportShortsCheck({ctx, ratio, span, eff, app, onJump}) {
    const rows = S.checkRows(shortsInput(ctx, {ratio, span, eff, app}));
    const sum = S.checkSummary(rows);
    return (
      <div className="xcheck" role="group" aria-label="发布前检查">
        <div className="xcheck__h">
          <b>发布前检查</b>
          <span className={cx('xcheck__sum', sum.error ? 'is-error' : sum.warn ? 'is-warn' : null)}>{S.checkHeadline(sum)}</span>
        </div>
        <div className="xcheck__grid">
          {rows.map((r) => {
            const tip = r.label + ' · ' + S.CHECK_STATUS_LABEL[r.status] + ' · ' + r.message;
            const body = (
              <>
                <i className={cx('xcheck__dot', 'is-' + r.status)} aria-hidden="true" />
                <b className="xcheck__lb">{r.label}</b>
                <span className="xcheck__msg">{r.message}</span>
                {r.pointer ? <NavChevron className="xcheck__go" /> : null}
              </>
            );
            return r.pointer
              ? <BCAction key={r.rule} type="button" className="xcheck__row is-link" title={tip} aria-label={tip}
                  data-rule={r.rule} onClick={() => onJump(r)}>{body}</BCAction>
              : <div key={r.rule} className="xcheck__row" title={tip} aria-label={tip} data-rule={r.rule}>{body}</div>;
          })}
        </div>
      </div>
    );
  }

  /** 「Shorts 快捷设置」：套用按钮 ＋ 一行规格；已经是这套设置时按钮换成「已按 Shorts 设置」。 */
  function ExportShortsPreset({matched, onApply, res}) {
    const note = matched ? S.presetNote(res) : '';
    return (
      <div className="xpreset">
        <Btn variant={matched ? 'quiet' : 'secondary'} size="s" icon={matched ? 'check' : null}
          disabled={matched} onClick={onApply}>{matched ? '已按 Shorts 设置' : 'Shorts 快捷设置'}</Btn>
        <span className="xpreset__spec" title={note || undefined}>{note ? S.presetLine() + ' · ' + note : S.presetLine()}</span>
      </div>
    );
  }

  Object.assign(window, {ExportShortsCheck, ExportShortsPreset, shortsExportInput: shortsInput});
})();
