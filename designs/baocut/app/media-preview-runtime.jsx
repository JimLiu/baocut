/* 媒体预览的浏览器资源与手势。产品设计 §3.3；仅使用原型随包文件。 */
(function () {
  const M = window.BC_MEDIA_PREVIEW,
    G = window.BC_MEDIA_GIF;
  function queueMediaRequest(app, files, text) {
    if (!text || !app.route.id) return false;
    const session = app.sessionById(app.route.id);
    files = files.map((file) => ({ ...file, kind: 'image' }));
    try {
      M.mergeAttachments(session.draftAttachments || [], files);
      app.patchSession(app.route.id, { draftAppend: { id: crypto.randomUUID(), text, images: files } });
      if (app.workspaceSingle) app.showConversation();
      app.toast('图片与请求已加入对话草稿；发送后再处理，原文件未修改。');
      return true;
    } catch (error) {
      app.toast(error.message, 'negative');
      return false;
    }
  }
  function downloadMedia(blob, name) {
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const blobUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法准备图片附件。'));
      reader.readAsDataURL(blob);
    });
  async function copyImage(src) {
    const image = await loadImage(src),
      canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
      throw new Error('这个环境暂不支持复制图片，请下载图片。');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片未能加载。'));
      image.src = src;
    });
  }
  function useMediaZoom(stage, canvas, percent, setZoom, phase) {
    const current = React.useRef({ percent, setZoom });
    current.current = { percent, setZoom };
    const touch = React.useRef(null),
      lastPinch = React.useRef(0);
    const around = React.useCallback((value, position) => {
      const viewport = stage.current,
        picture = canvas.current;
      if (!viewport || !picture) {
        current.current.setZoom(String(value));
        return;
      }
      const before = picture.getBoundingClientRect(),
        bounds = viewport.getBoundingClientRect();
      const p = position || { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      const anchor = M.point(p, before);
      if (!anchor) return;
      ReactDOM.flushSync(() => current.current.setZoom(String(value)));
      const after = picture.getBoundingClientRect();
      viewport.scrollLeft += after.left + after.width * anchor.x - p.x;
      viewport.scrollTop += after.top + after.height * anchor.y - p.y;
    }, []);
    React.useEffect(() => {
      const element = stage.current;
      if (!element) return;
      const wheel = (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          around(M.wheelZoom(current.current.percent, e.deltaY), { x: e.clientX, y: e.clientY });
        }
      };
      const center = (touches) => ({ x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 });
      const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const start = (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          touch.current = { distance: distance(e.touches), zoom: current.current.percent };
        }
      };
      const move = (e) => {
        if (e.touches.length === 2 && touch.current) {
          e.preventDefault();
          around(M.pinchZoom(touch.current.zoom, touch.current.distance, distance(e.touches)), center(e.touches));
          lastPinch.current = performance.now();
        }
      };
      const end = () => {
        touch.current = null;
      };
      element.addEventListener('wheel', wheel, { passive: false });
      element.addEventListener('touchstart', start, { passive: false });
      element.addEventListener('touchmove', move, { passive: false });
      element.addEventListener('touchend', end);
      element.addEventListener('touchcancel', end);
      return () => {
        element.removeEventListener('wheel', wheel);
        element.removeEventListener('touchstart', start);
        element.removeEventListener('touchmove', move);
        element.removeEventListener('touchend', end);
        element.removeEventListener('touchcancel', end);
      };
    }, [around, phase]);
    return { around, isPinching: () => touch.current !== null || performance.now() - lastPinch.current < 250 };
  }
  async function decodeGif(url, signal) {
    if (typeof ImageDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined' || !(await ImageDecoder.isTypeSupported('image/gif')))
      throw new Error('这个环境暂不支持 GIF 分帧，仍可查看和下载原图。');
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('GIF 未能加载。');
    const reader = response.body.getReader(),
      chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > G.MAX_BYTES) {
          await reader.cancel();
          throw new Error('GIF 超过 64 MiB，无法分帧。');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const blob = new Blob(chunks, { type: 'image/gif' });
    if (blob.size > G.MAX_BYTES) throw new Error('GIF 超过 64 MiB，无法分帧。');
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      info = G.parse(bytes),
      frames = [];
    if (info.frames.length < 2) throw new Error('GIF 只有一帧，可以按普通图片查看。');
    const decoder = new ImageDecoder({ data: bytes, type: 'image/gif', preferAnimation: true });
    const abort = () => decoder.close();
    signal.addEventListener('abort', abort, { once: true });
    const dispose = () => frames.forEach((frame) => URL.revokeObjectURL(frame.url));
    try {
      await decoder.tracks.ready;
      signal.throwIfAborted();
      if (decoder.tracks.selectedTrack.frameCount !== info.frames.length) throw new Error('GIF 帧数不匹配。');
      const canvas = new OffscreenCanvas(info.width, info.height),
        context = canvas.getContext('2d');
      for (let index = 0; index < info.frames.length; index++) {
        signal.throwIfAborted();
        const { image } = await decoder.decode({ frameIndex: index });
        try {
          context.clearRect(0, 0, info.width, info.height);
          context.drawImage(image, 0, 0);
          const png = await canvas.convertToBlob({ type: 'image/png' });
          signal.throwIfAborted();
          frames.push({ url: URL.createObjectURL(png), blob: png, duration: info.frames[index].duration });
        } finally {
          image.close();
        }
      }
      return { ...info, frames, blob, bytes, dispose };
    } catch (error) {
      dispose();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      decoder.close();
    }
  }
  async function gifSheet(gif) {
    const columns = Math.ceil(Math.sqrt(gif.frames.length)),
      size = Math.min(240, Math.floor(2048 / columns));
    const canvas = document.createElement('canvas');
    canvas.width = columns * size;
    canvas.height = Math.ceil(gif.frames.length / columns) * (size + 24);
    const ctx = canvas.getContext('2d');
    /* @ds-allow: 此处画的是发给模型的分帧联系表，不是界面颜色。 */
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < gif.frames.length; i++) {
      const image = await loadImage(gif.frames[i].url),
        x = (i % columns) * size,
        y = Math.floor(i / columns) * (size + 24),
        scale = Math.min(size / image.width, size / image.height);
      ctx.drawImage(image, x + (size - image.width * scale) / 2, y, image.width * scale, image.height * scale);
      /* @ds-allow: 分帧联系表中的黑色帧号，属于输出图像。 */
      ctx.fillStyle = '#000000';
      ctx.font = '16px sans-serif';
      ctx.fillText(String(i + 1), x + 8, y + size + 18);
    }
    return canvas.toDataURL('image/png');
  }
  let clearTransition = () => {},
    transitionVersion = 0;
  function transitionMediaImage(source, id, change) {
    clearTransition();
    const version = ++transitionVersion;
    if (!source || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    let destination;
    source.style.viewTransitionName = 'bc-media-image';
    const transition = document.startViewTransition(async () => {
      if (version !== transitionVersion) return;
      source.style.viewTransitionName = '';
      ReactDOM.flushSync(change);
      destination = Array.from(document.querySelectorAll(`.home-files__content img[data-media-image="${CSS.escape(id)}"]`)).find(
        (image) => image.getClientRects().length > 0
      );
      if (destination) {
        destination.style.viewTransitionName = 'bc-media-image';
        await destination.decode().catch(() => {});
      }
    });
    const cleanup = () => {
      if (version !== transitionVersion) return;
      source.style.viewTransitionName = '';
      if (destination) destination.style.viewTransitionName = '';
    };
    clearTransition = () => {
      transition.skipTransition();
      cleanup();
    };
    transition.finished.catch(() => {}).finally(cleanup);
  }
  Object.assign(window, {
    transitionMediaImage,
    queueMediaRequest,
    downloadMedia,
    mediaBlobUrl: blobUrl,
    copyMediaImage: copyImage,
    loadMediaImage: loadImage,
    useMediaZoom,
    decodeMediaGif: decodeGif,
    mediaGifSheet: gifSheet
  });
})();
