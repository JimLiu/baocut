/* 字幕属性的交互规则；不复制动效关键帧，不改变字幕文本或切分。 */
(function () {
  const descriptions = {
    none: '整句保持显示，适合长视频与信息较多的内容。',
    colourHighlight: '正在读的词换一种颜色，轻松跟上说话节奏。',
    boxHighlight: '色块跟着当前词移动，让每个词都清楚醒目。',
    karaoke: '词语随朗读依次点亮，读过的词保持清晰。',
    reveal: '跟着说话逐词出现，读过的词留在画面上。',
    highlight: '正在读的词清晰显示，其余词淡化。',
    flipClock: '整句像翻页钟一样翻入画面。',
    impact: '一次显示一个词，适合节奏鲜明的短句。',
    floatInTop: '每个词从上方轻轻落入。',
    floatInBottom: '每个词从下方轻轻浮入。',
    scaleIn: '整句字幕从小到大出现。',
    dropIn: '每个词从较大尺寸收拢到位。',
    impactPop: '当前词放大弹出，突出说话节奏。',
    rotateFlipClock: '字幕带着倾斜角度翻入。',
    rotateHighlight: '整句轻微倾斜，同时为当前词变色。',
    stack: '用方形色块标出正在读的词。',
    stomp: '整句快速放大落定，适合有力的开场。',
    bounce: '每个词随朗读轻轻弹跳。',
    paint: '颜色随朗读刷过文字。',
  };
  const common = ['none', 'colourHighlight', 'boxHighlight', 'karaoke', 'reveal', 'highlight'];
  const description = (key) => descriptions[key] || '跟随说话节奏播放。';
  // 旋转高亮的字色来自它组合的 colourHighlight 轨。
  const colourLabel = (key) => {
    if (key === 'rotateHighlight') return '当前词颜色';
    if (key === 'paint') return '已读词颜色';
    const param = window.BC_SA.colourParamOf(key);
    return param === 'boxColour' ? '高亮背景色' : param === 'textColour' ? '当前词颜色' : null;
  };
  const groups = (catalog) => [
    {name: '常用', note: '从这里开始', items: common.map((k) => catalog.find((a) => a.k === k)).filter(Boolean)},
    {name: '更多动画', note: '更鲜明的节奏与动感', items: catalog.filter((a) => !common.includes(a.k))},
  ];
  function toggleAnimation(line, enabled, remembered) {
    if (!enabled) return line.textMotion ? {textMotion: null, wordAnim: 'none', caption: null} : {wordAnim: 'none', caption: null};
    if (remembered && remembered.textMotion) return remembered;
    return remembered && (remembered.caption || remembered.wordAnim !== 'none')
      ? remembered : {wordAnim: 'karaoke', caption: null};
  }
  // 标记同时核对文字；改写字幕后不得把强调意图错误转移到别的词上。
  const isMarked = (h, cueId, text, index) => !!(h && h.on && ((h.marks || {})[cueId] || [])
    .some((m) => m.index === index && m.text === text));
  function toggleMark(h, cueId, text, index) {
    const marks = Object.assign({}, h.marks);
    const list = marks[cueId] || [];
    const hit = list.some((m) => m.index === index && m.text === text);
    marks[cueId] = hit ? list.filter((m) => m.index !== index) : list.filter((m) => m.index !== index).concat({text, index});
    if (!marks[cueId].length) delete marks[cueId];
    return marks;
  }
  window.BC_SI = {description, colourLabel, groups, toggleAnimation, isMarked, toggleMark};
})();
