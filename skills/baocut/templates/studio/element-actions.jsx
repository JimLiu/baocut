// BaoCut Subtitle Studio — 叠加元素的动作层（新建 / 上传 / 移动 / 改字 / 删除）。
//
// 事务管道本身（串行队列、baseRev、409/423、skipped 收口）留在 store.jsx 的
// `applyTimelineOps`；本文件只把它组合成产品动作：op 由 element-ops.js 构造，
// 成功后选中新元素并给一条带「撤销」的提示。抽出来是因为 store.jsx 早已超过单文件
// 预算，而这些动作是纯组合、不持有自己的状态。
(() => {
const { useCallback } = React;
const { toast } = window;
const EOPS = window.BCS_ELEMENT_OPS;

const UPLOAD_URL = '__bcut/upload';
// 上传失败的服务端 reason → 中文文案（D14：魔数判类型、20 MiB 上限、项目锁）。
const UPLOAD_REASONS = {
  unsupported: '只支持 PNG、JPEG、GIF、WebP 图片',
  'body-too-large': '图片超过 20 MiB 上限',
  busy: '项目正被其他任务占用，稍后再试',
};

// 新建后立刻选中：id 由服务端分配（`applied[].elementId`），前端不猜。
function addedElementId(result) {
  const applied = (result && Array.isArray(result.applied)) ? result.applied : [];
  const entry = applied.find((item) => item && item.kind === 'addElement');
  return entry ? entry.elementId : null;
}

// 浏览器侧探测自然宽高：几何要用（投影里没有自然尺寸），也随 putSource 记进 source。
function probeImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这个文件不是浏览器能解码的图片'));
    };
    probe.src = url;
  });
}

async function uploadImage(file) {
  const response = await fetch(UPLOAD_URL + '?name=' + encodeURIComponent(file.name || 'image'), {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const uploaded = await response.json().catch(() => ({}));
  if (!response.ok || !uploaded.ok) {
    throw new Error(UPLOAD_REASONS[uploaded.reason] || uploaded.error || ('HTTP ' + response.status));
  }
  return uploaded;
}

// deps：applyTimelineOps / findElement 来自 store 的事务层，docRef / playerRef 读当前
// 文档与播放头，setSel 写选中，undo 提供提示里的「撤销」动作。
function useElementActions(deps) {
  const { applyTimelineOps, findElement, docRef, playerRef, setSel, undo } = deps;
  const undoAction = useCallback(() => ({ label: '撤销', onClick: () => undo() }), [undo]);
  const duration = useCallback(
    () => (docRef.current && docRef.current.meta.duration) || 0,
    [docRef],
  );
  const time = useCallback(() => (playerRef.current && playerRef.current.t) || 0, [playerRef]);

  const addTextElement = useCallback(() => {
    if (!EOPS) return Promise.resolve(null);
    const op = EOPS.addTextElement({ time: time(), duration: duration() });
    return applyTimelineOps([op], '添加文本元素').then((result) => {
      const id = addedElementId(result);
      if (!id) return null;
      setSel({ kind: 'el', id });
      toast('已在播放头处添加文本', { variant: 'positive', action: undoAction() });
      return id;
    });
  }, [applyTimelineOps, duration, setSel, time, undoAction]);

  const addWatermark = useCallback((text) => {
    if (!EOPS) return Promise.resolve(null);
    return applyTimelineOps([EOPS.addWatermark({ text })], '添加水印').then((result) => {
      const id = addedElementId(result);
      if (!id) return null;
      setSel({ kind: 'el', id });
      toast('已添加水印，覆盖整片直到你改窗口', { variant: 'positive', action: undoAction() });
      return id;
    });
  }, [applyTimelineOps, setSel, undoAction]);

  // 上传一张图：探测自然尺寸（几何要用，投影里没有）→ 字节直传 __bcut/upload。
  // 失败都在这里收口成一条中文提示，调用方只需要判 null。
  const uploadPicked = useCallback(async (file) => {
    let natural;
    try {
      natural = await probeImageSize(file);
    } catch (error) {
      toast(error.message || '读取图片失败', { variant: 'negative' });
      return null;
    }
    let uploaded;
    try {
      uploaded = await uploadImage(file);
    } catch (error) {
      toast('上传图片失败：' + (error.message || String(error)), { variant: 'negative' });
      return null;
    }
    return { path: uploaded.path, naturalWidth: natural.width, naturalHeight: natural.height };
  }, []);

  // 图片：上传 → putSource + addElement 一个事务（撤销一步就该让这张图不再被引用，
  // 所以两条 op 必须同事务）。`options.role === 'watermark'` 建的是图片水印（全片、
  // 右上角），入口在水印层的添加行。
  const addImageElement = useCallback(async (file, options) => {
    if (!EOPS || !file) return null;
    const picked = await uploadPicked(file);
    if (!picked) return null;
    const watermark = !!(options && options.role === 'watermark');
    const ops = EOPS.addImageElement({
      ...picked,
      time: time(),
      duration: duration(),
      role: watermark ? 'watermark' : null,
    });
    const id = addedElementId(await applyTimelineOps(ops, watermark ? '添加图片水印' : '添加图片元素'));
    if (!id) return null;
    setSel({ kind: 'el', id });
    toast(watermark ? '已添加图片水印，覆盖整片直到你改窗口' : '已在播放头处添加图片',
      { variant: 'positive', action: undoAction() });
    return id;
  }, [applyTimelineOps, duration, setSel, time, undoAction, uploadPicked]);

  // 换图：新 source + 改 srcId（不覆盖旧 source，见 element-ops.js 的注释）。
  const replaceElementImage = useCallback(async (element, file) => {
    if (!EOPS || !element || !file) return null;
    const picked = await uploadPicked(file);
    if (!picked) return null;
    const current = findElement(element.id) || element;
    const result = await applyTimelineOps(
      EOPS.replaceImageSource(current, picked),
      '替换图片 ' + current.id,
    );
    if (!result) return null;
    toast('已替换图片', { variant: 'positive', action: undoAction() });
    return result;
  }, [applyTimelineOps, findElement, undoAction, uploadPicked]);

  // 拖动写回：place.x/y 由调用方按画面几何算好（element-geometry.js movedPlace）。
  const moveElement = useCallback((element, place) => {
    if (!EOPS || !element) return Promise.resolve(null);
    const current = findElement(element.id) || element;
    return applyTimelineOps([EOPS.movePlace(current, place)], '移动元素 ' + element.id);
  }, [applyTimelineOps, findElement]);

  const setElementText = useCallback((element, text) => {
    if (!EOPS || !element) return Promise.resolve(null);
    const current = findElement(element.id) || element;
    if ((current.text == null ? '' : current.text) === text) return Promise.resolve(null);
    return applyTimelineOps([EOPS.setText(current, text)], '改元素文字 ' + element.id);
  }, [applyTimelineOps, findElement]);

  // 通用补丁（样式 / 窗口 / 平铺等，检查器与水印层用）：缺省不带 base；要做 CAS 的
  // 调用方自己传，但**数值字段别传** —— 服务端按 serde_json 的 Number 表示比较，
  // JS 的 50 与磁盘上的 50.0 永远不相等（详见 element-ops.js movePlace 的注释）。
  const patchElement = useCallback((element, set, options) => {
    const elId = typeof element === 'string' ? element : (element && element.id);
    if (!elId || !set) return Promise.resolve(null);
    const op = { kind: 'patchElement', elId, set };
    if (options && options.base) op.base = options.base;
    return applyTimelineOps([op], (options && options.label) || ('修改元素 ' + elId));
  }, [applyTimelineOps]);

  const removeElement = useCallback((element) => {
    if (!EOPS || !element) return Promise.resolve(null);
    const elId = typeof element === 'string' ? element : element.id;
    const label = EOPS.elementLabel(typeof element === 'string' ? findElement(elId) : element);
    return applyTimelineOps([EOPS.removeElement(elId)], '删除元素 ' + elId).then((result) => {
      if (!result) return null;
      setSel((current) => (current && current.kind === 'el' && current.id === elId ? null : current));
      toast('已删除' + label, { variant: 'neutral', action: undoAction() });
      return result;
    });
  }, [applyTimelineOps, findElement, setSel, undoAction]);

  return {
    addTextElement, addImageElement, addWatermark,
    moveElement, setElementText, patchElement, removeElement, replaceElementImage,
  };
}

window.BCS_ELEMENT_ACTIONS = { useElementActions, addedElementId };
})();
