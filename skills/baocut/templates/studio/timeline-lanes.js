// BaoCut Subtitle Studio — 时间轴显示行的车道分配（纯函数）。
//
// 一条逻辑轨（`timeline.json` 的 `tracks[]`）里的元素可以在时间上重叠；时间轴要把
// 它们摊成互不重叠的显示行。规则与原型 `designs/baocut-mac/app/timeline-lanes.js`
// 以及 Mac 的 `TimelineLanePartition` 逐字同源（first-fit + 同一个 EPSILON），
// 三端因此从同一份数据派生出同样的行数与行号。
//
// first-fit 的含义：按 start 升序（相同 start 按原数组序稳定）逐个放，放进第一条
// 「最后一个元素的 end ≤ 本元素 start」的行，没有就新开一行。EPSILON 让首尾相接
// （前一个 end == 后一个 start）算作不重叠，否则每条相邻元素都会各占一行。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_TIMELINE_LANES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const EPSILON = 0.001;

  function partition(values, start, end) {
    const ordered = (values || [])
      .map((value, index) => ({ value, index }))
      .sort((a, b) => {
        const byStart = start(a.value) - start(b.value);
        return byStart || a.index - b.index;
      });
    const lanes = [];
    ordered.forEach(({ value }) => {
      const valueStart = start(value);
      let lane = lanes.find((items) => end(items[items.length - 1]) <= valueStart + EPSILON);
      if (!lane) {
        lane = [];
        lanes.push(lane);
      }
      lane.push(value);
    });
    return lanes;
  }

  // `timelineEnd` 是 end 缺席时的兜底（投影里 end 已求值，仍留着这条兜底给草稿态）。
  function plan(elements, timelineEnd) {
    const lanes = partition(
      elements,
      (element) => (typeof element.start === 'number' ? element.start : 0),
      (element) => (typeof element.end === 'number' ? element.end : timelineEnd),
    ).map((items, index) => ({ index, elements: items, elementIds: items.map((item) => item.id) }));
    const laneByElementId = {};
    lanes.forEach((lane) => lane.elementIds.forEach((id) => { laneByElementId[id] = lane.index; }));
    return { lanes, laneByElementId };
  }

  return { EPSILON, partition, plan };
});
