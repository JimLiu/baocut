/* BaoCut 原型 — 配乐轨（剧情短片 §5.5，2026-09-24）
   window.BC_SCORE。纯函数，无 React、无 DOM。

   动画项目的配乐按总线拆成几路 stem（`bcut score render` 写出 music / amb / sfx 三路），
   每一路落到时间轴上是一条手动轨 `score:<bus>`。这里只回答三件事：

     · 这一路叫什么——行头牌子写短名（「音乐」「环境」「音效」），整名进 tip：「配乐 · 环境声」；
     · 过期没有——总谱 / 事件表 / 词表在这一路生成之后改过，就是过期（`stale`，
       改过的那几个输入是 `staleInputs`）。行头挂一颗黄点，哪几个输入改过进 tip；
     · 重新生成这一路 / 全部——只有 App 有（`BC_SURFACE.ai`，§22.4），Web 只看状态。

   静音不写回动画稿：行头那只喇叭只在时间轴上关掉这一路，BCF 里的配乐还在；
   要从作品里去掉得让 Agent 改稿。这句话挂在喇叭 tip 与轨菜单里（台账 2026-09-24-233210）。 */
(function () {
  const PREFIX = 'score:';
  const BUSES = {
    music: {name: '音乐', badge: '音乐'},
    amb: {name: '环境声', badge: '环境'},
    sfx: {name: '音效', badge: '音效'},
  };
  const MUTE_NOTE = '静音只在时间轴上关掉这一路，不改动画稿；要从作品里去掉，请让 Agent 改稿。';
  const FRESH_SUB = '已是最新，按总谱重渲';
  const BUSY_SUB = '配乐或另一个音频任务正在跑，完成后再试';

  /** 轨 id → 总线名；不是配乐轨给 null。`tr-au.score:amb`（展示泳道 id）与 `score:amb` 都认。 */
  function busOf(id) {
    const s = String(id || '');
    const at = s.indexOf(PREFIX);
    if (at < 0) return null;
    if (at > 0 && s.slice(0, at) !== 'tr-au.') return null;
    const bus = s.slice(at + PREFIX.length);
    return bus || null;
  }
  /** 总线的整名：三路认得的给中文名，别的总线原样写（作者自定义的总线名本来就是给人看的）。 */
  const busName = (bus) => (BUSES[bus] ? BUSES[bus].name : String(bus || ''));
  /** 行头牌子上的短名（60px 行头放得下两个字）。 */
  const badge = (bus) => (BUSES[bus] ? BUSES[bus].badge : String(bus || '').slice(0, 4).toUpperCase());
  /** 这一路在时间轴 / 导出清单上的名字。 */
  const laneName = (bus) => '配乐 · ' + busName(bus);

  /** 过期说明：列出改过的输入；没有明细时给一句通用的。不过期给 null。 */
  function staleTip(track) {
    if (!track || !track.stale) return null;
    const inputs = (track.staleInputs || []).filter(Boolean);
    return inputs.length ? '已过期：' + inputs.join('、') + ' 在这一路生成后改过' : '已过期，需要重新生成这一路';
  }

  /** 行头整条 tip：名字 ＋ 过期说明。 */
  function headTip(track) {
    const tip = staleTip(track);
    return laneName(track.bus) + (tip ? ' · ' + tip : '');
  }

  /** 轨菜单里「重新生成这一路」的副题：忙时说在忙，过期时说哪里改了，否则说按总谱重渲。 */
  function regenSub(track, busy) {
    if (busy) return BUSY_SUB;
    return staleTip(track) || FRESH_SUB;
  }

  /** 一路（`bus`）或全部（`null`）重新生成完：清掉对应的过期位，返回新表。 */
  function markFresh(tracks, bus) {
    return (tracks || []).map((t) => (bus == null || t.bus === bus
      ? Object.assign({}, t, {stale: false, staleInputs: []}) : t));
  }

  /** 过期的路数，给「重新生成全部配乐」的副题用。 */
  const staleCount = (tracks) => (tracks || []).filter((t) => t.stale).length;

  Object.assign(window, {BC_SCORE: {PREFIX, BUSES, MUTE_NOTE, FRESH_SUB, BUSY_SUB,
    busOf, busName, badge, laneName, staleTip, headTip, regenSub, markFresh, staleCount}});
})();
