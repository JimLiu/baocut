/* 主媒体放不出来时的舞台提示 —— §11.3（2026-09-26）。
   window.BC_STAGE_MEDIA。纯函数，无 React、无 DOM。

   两种情形，同一张卡：
     · missing    打开前 stat 不到——被移动、改名、删掉，或在拔掉的硬盘上；
     · unplayable 文件在，播放器打开或解码失败（附播放器原话）。
   两种都**不是打开失败**：项目照常打开，字幕、元素、时间轴照常走（时钟换成不依赖媒体的
   那一只），只是没有画面和原声。卡片常驻画面正中，播放时也不收。

   「去哪儿找回画面」只在 missing 且这个表面有项目页（`BC_SURFACE.pages`）时说：
   项目卡 ⋯ 菜单的「重新关联媒体…」只在源文件缺失时出现，编辑器里不另开第二个门
   （§10）；Web 没有这个入口（§22）。unplayable 时文件还在，指过去是死路，不说。

   产品两侧：App `apps/baocut/src/app/editor/stage/mod.rs::media_notice_layer`，
   Web `apps/web/src/features/editor/stage/MediaNotice.tsx`。 */
(function () {
  const COPY = {
    missing: {title: '找不到源文件',
      body: '文件可能被移动、改名或删掉了，也可能在已经拔掉的硬盘上。字幕照常可以播放，只是没有画面和原声。'},
    unplayable: {title: '源文件无法播放',
      body: (error) => `播放器打不开这个文件：${error}。字幕照常可以播放，只是没有画面和原声。`},
  };
  const RELINK_HINT = '要找回画面，回到视频列表，在这部视频的 ⋯ 菜单里选「重新关联媒体…」。';
  /** 原型开关「放不出」挡位用的演示原话（AVFoundation 解不了时的那一句） */
  const DEMO_ERROR = 'Cannot Open (AVFoundationErrorDomain -11829)';

  /** 路径 → 文件名；取不到文件名就原样给路径 */
  function fileName(path) {
    const s = String(path || '');
    const m = s.match(/[^/\\]+$/);
    return m ? m[0] : s;
  }

  /** 这个项目此刻的主媒体问题：`demo` 是原型开关（'auto' 跟项目数据走），
      返回 null / 'missing' / 'unplayable'。没有主媒体的项目（空白、纯元素）不算问题。 */
  function problemOf(proj, demo) {
    if (!proj || !proj.src) return null;
    if (demo === 'missing' || demo === 'unplayable') return demo;
    if (demo === 'ok') return null;
    return proj.src.state === 'missing' ? 'missing' : null;
  }

  /** 卡片内容；`surface` 是 BC_SURFACE（只读 `pages`） */
  function notice(proj, demo, surface) {
    const kind = problemOf(proj, demo);
    if (!kind) return null;
    const c = COPY[kind];
    return {
      kind,
      title: c.title,
      name: fileName(proj.src.name || proj.src.path),
      body: kind === 'unplayable' ? c.body(DEMO_ERROR) : c.body,
      hint: kind === 'missing' && surface && surface.pages ? RELINK_HINT : null,
    };
  }

  window.BC_STAGE_MEDIA = {COPY, RELINK_HINT, DEMO_ERROR, fileName, problemOf, notice};
})();
