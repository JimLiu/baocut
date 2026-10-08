/* 旧版项目导入的进度与结果（2026-10-08 用户要求：看不出正在导入、不知道导入结果；
   没导入的要说清原因和怎么补救，可以跳过或重试）。window.BC_LEGACY_IMPORT_RUN。纯函数，无 React、无 DOM。

   启动询问里点「导入」之后，导入就是一条后台任务（`kind: 'legacy-import'`）：顶栏胶囊、侧栏迷你条、
   后台任务页与任务详情读同一条记录，和转录、导出一样看得到进度；跑完留在任务历史里，结果与没导入的原因都在详情页。

   记录上的 `legacy`：`{dest, items, waiting}`；每一项 `{path, title, edited, state, missing, volume, error}`，
   `state` 是 queued | running | done | missing-media | error | skipped：
   - missing-media：项目用到的素材文件不在（`missing` 是缺的路径）。`volume`（`{root, name}`）有值，说明素材在一块
     现在没接上的外接硬盘上，同一块盘的归成一组——接上后重试。没有 `volume` 的是文件被移动、改名或删除了。
   - error：旧项目文件读不出来等，`error` 是原因。重试多半还是失败，所以给「在文件夹中显示」看原文件。
   - skipped：用户跳过，以后不再自动导入；随时可以「改为导入」（就是重试这一个）。
   没导入的（missing-media / error）下次启动会自动再试；跳过的不再试。`waiting`：其他任务在跑时导入先停下，等它们结束再继续。
   这里的「重试」只重跑这几个项目的导入，属于直接任务的重试，不是 §17.3 红线里的 AI flow 重试。

   实现对应（architecture-design §2.7，protocol legacy-import.ts `LegacyImportRun`）：Runtime 在 `legacy-import` 主题上报这次
   启动的导入，不是一条 Job；桌面界面把它拼成任务页里的一行（packages/ui model/legacy-import-run.ts）；视频页顶栏的任务胶囊只列这部视频的任务，不含它。原因多分了一种：
   missing-media 有 `volume` 的是 `offline`、没有的是 `missing`；error 拆成 `unreadable`（读不出来）与 `failed`
   （导入时出错，带导入报告，「在文件夹中显示」指向报告）。重试与跳过是 `legacyImport.retry`、`legacyImport.setSkipped`。 */
(function () {
  const PENDING = ['missing-media', 'error'];

  /** 演示：`BC_LEGACY_IMPORT.DEMO_FOUND` 里这几项导入不成，其余导入成功。`moved` 的文件在各平台的视频文件夹下。 */
  const DEMO_PROBLEMS = {
    '周末 vlog · 京都赏枫': {state: 'missing-media', onDrive: true, missing: ['2025/京都/A001.MP4', '2025/京都/A002.MP4', '2025/京都/A007.MP4']},
    '旅行剪辑 · 冰岛环岛': {state: 'missing-media', onDrive: true, missing: ['2024/冰岛/DJI_0042.MP4', '2024/冰岛/DJI_0043.MP4']},
    '课程录屏 · 第 2 讲': {state: 'missing-media', missing: ['课程录屏/第 2 讲.mov']},
    '读书会 · 第 7 次': {state: 'error', error: '项目文件不完整（project.json 只写了一半），读不出时间线'},
  };
  /** 演示的各平台位置：旧项目、外接硬盘（macOS 挂在 /Volumes，Linux 在 /media，Windows 是一个盘符）、视频文件夹。 */
  const DEMO_PLACES = {
    darwin: {projects: '~/Library/Application Support/BaoCut/projects', drive: {root: '/Volumes/Extreme SSD', name: 'Extreme SSD'}, videos: '~/Movies'},
    linux: {projects: '~/.config/BaoCut/projects', drive: {root: '/media/me/Extreme SSD', name: 'Extreme SSD'}, videos: '~/Videos'},
    win32: {projects: 'C:\\Users\\me\\AppData\\Roaming\\BaoCut\\projects', drive: {root: 'E:\\', name: 'Extreme SSD'}, videos: 'C:\\Users\\me\\Videos'},
  };
  const placesOf = (host) => DEMO_PLACES[host] || DEMO_PLACES.darwin;
  /** 演示里那块外接硬盘（原型开关「接上硬盘」接的就是它）。 */
  const demoDrive = (host) => placesOf(host).drive;
  const join = (root, rel, host) => (host === 'win32'
    ? root.replace(/\\$/, '') + '\\' + rel.replace(/\//g, '\\') : root.replace(/\/$/, '') + '/' + rel);

  /** 询问里发现的项目 → 一次导入的起点：全部排队，第一个开始导入。`outcome` 是演示用的结局，界面不读。 */
  function start(found, dest, host) {
    const at = placesOf(host);
    const items = (found || []).map((f, i) => {
      const p = DEMO_PROBLEMS[f.title];
      const outcome = p ? {
        state: p.state,
        volume: p.onDrive ? at.drive : null,
        missing: (p.missing || []).map((m) => join(p.onDrive ? at.drive.root : at.videos, m, host)),
        error: p.error || null,
      } : {state: 'done'};
      return {path: join(at.projects, `p${i + 1}`, host), title: f.title, edited: f.edited || null, state: 'queued', outcome};
    });
    return advance({dest, items, waiting: false, batch: null});
  }

  /** 没有在导入的就把下一个排队的拉起来。 */
  function advance(legacy) {
    if (legacy.items.some((it) => it.state === 'running')) return legacy;
    const i = legacy.items.findIndex((it) => it.state === 'queued');
    if (i < 0) return legacy;
    return Object.assign({}, legacy, {items: legacy.items.map((it, j) => (j === i ? Object.assign({}, it, {state: 'running'}) : it))});
  }

  /** 演示的一步：在导入的那个落到它的结局，再拉起下一个。`mounted` 是已接上的外接硬盘根目录。
      素材在硬盘上的，硬盘接上了就导入成功；被挪走的文件与读不出来的项目，重试还是一样。 */
  function step(legacy, mounted) {
    const on = mounted || [];
    const items = legacy.items.map((it) => {
      if (it.state !== 'running') return it;
      const o = it.outcome || {state: 'done'};
      if (o.state === 'done' || (o.volume && on.includes(o.volume.root))) {
        return Object.assign({}, it, {state: 'done', missing: [], volume: null, error: null});
      }
      return Object.assign({}, it, {state: o.state, missing: o.missing || [], volume: o.volume || null, error: o.error || null});
    });
    return advance(Object.assign({}, legacy, {items}));
  }

  /** 一路走到没有排队、没有在导入的为止（原型开关「直接看结果」）。 */
  function settle(legacy, mounted) {
    let l = legacy;
    for (let i = 0; i <= l.items.length && l.items.some((it) => it.state === 'running'); i++) l = step(l, mounted);
    return l;
  }

  function counts(legacy) {
    const items = (legacy && legacy.items) || [];
    const n = (s) => items.filter((it) => it.state === s).length;
    const c = {total: items.length, done: n('done'), missing: n('missing-media'), error: n('error'),
      skipped: n('skipped'), queued: n('queued'), running: n('running')};
    c.pending = c.missing + c.error;
    c.live = c.queued + c.running;
    return c;
  }

  const current = (legacy) => ((legacy && legacy.items) || []).find((it) => it.state === 'running') || null;

  /** 这几项重新排队（没导入的或跳过的；`paths` 缺省 = 全部没导入的），再拉起下一个。
      `batch` 记下这一次重试了哪几个，跑完的 toast 只报它们的结果。 */
  function retry(legacy, paths) {
    const pick = (it) => (paths ? paths.includes(it.path) && (PENDING.includes(it.state) || it.state === 'skipped')
      : PENDING.includes(it.state));
    const picked = legacy.items.filter(pick).map((it) => it.path);
    if (!picked.length) return legacy;
    const items = legacy.items.map((it) => (picked.includes(it.path) ? Object.assign({}, it, {state: 'queued', was: null}) : it));
    const batch = counts(legacy).live && legacy.batch ? legacy.batch.concat(picked) : picked;
    return advance(Object.assign({}, legacy, {items, batch}));
  }

  /** 跳过这几项（`paths` 缺省 = 全部没导入的）：以后不再自动导入。`was` 留着原来的原因，撤销跳过时放回去。 */
  function skip(legacy, paths) {
    const items = legacy.items.map((it) => (PENDING.includes(it.state) && (!paths || paths.includes(it.path))
      ? Object.assign({}, it, {state: 'skipped', was: it.state}) : it));
    return Object.assign({}, legacy, {items});
  }

  /** 撤销跳过：放回跳过前的原因（不重新导入；要导入用 retry）。 */
  function unskip(legacy, paths) {
    const items = legacy.items.map((it) => (it.state === 'skipped' && it.was && paths.includes(it.path)
      ? Object.assign({}, it, {state: it.was, was: null}) : it));
    return Object.assign({}, legacy, {items});
  }

  /** 没导入的按原因分组：每块没接上的硬盘一组、文件不在原处一组、项目读不出来一组。
      每组带一句原因（why）和一句怎么办（fix），视图不另写。 */
  function groups(legacy) {
    const items = ((legacy && legacy.items) || []).filter((it) => PENDING.includes(it.state));
    const out = [];
    const add = (key, make, it) => {
      let g = out.find((x) => x.key === key);
      if (!g) { g = Object.assign({key, items: []}, make()); out.push(g); }
      g.items.push(it);
    };
    items.forEach((it) => {
      if (it.state === 'missing-media' && it.volume) {
        add('volume:' + it.volume.root, () => ({kind: 'volume', volume: it.volume}), it);
      } else if (it.state === 'missing-media') add('moved', () => ({kind: 'moved'}), it);
      else add('error', () => ({kind: 'error'}), it);
    });
    const rank = {volume: 0, moved: 1, error: 2};
    return out.sort((a, b) => rank[a.kind] - rank[b.kind]).map((g) => Object.assign(g, groupText(g)));
  }

  function groupText(g) {
    const n = g.items.length;
    if (g.kind === 'volume') {
      return {
        title: `移动硬盘「${g.volume.name}」没接上`,
        why: `${n === 1 ? '这个项目' : `这 ${n} 个项目`}用到的视频在这块硬盘上（${g.volume.root}），现在读不到。`,
        fix: '接上硬盘后点「重试」。不处理的话，下次启动 BaoCut 会自动再试；素材不要了就点「跳过」，以后不再导入。',
        short: `${n} 个项目的素材在没接上的「${g.volume.name}」上`,
      };
    }
    if (g.kind === 'moved') {
      return {
        title: '素材文件不在原来的位置',
        why: '项目用到的文件被移动、改名或删除了，旧项目里记的路径找不到它们。',
        fix: '把文件放回原来的位置后点「重试」；找不回来就点「跳过」。',
        short: `${n} 个项目的素材文件找不到`,
      };
    }
    return {
      title: '旧项目文件读不出来',
      why: '旧项目文件可能损坏了，重试多半还是不行。',
      fix: '可以在文件夹中看看原文件还在不在、能不能用旧版打开；不需要了就点「跳过」。',
      short: `${n} 个项目的文件读不出来`,
    };
  }

  /** 一行没导入的项目下面那句：缺几个文件、第一个缺的路径；读不出来的写原因。 */
  function itemNote(it) {
    if (it.state === 'error') return it.error || '读不出来';
    const m = it.missing || [];
    if (!m.length) return '素材文件找不到';
    return m.length > 1 ? `缺 ${m.length} 个文件，例如 ${m[0]}` : `缺 ${m[0]}`;
  }

  /** 任务页卡片上的一句说明：`2 个的素材在没接上的「Extreme SSD」上，1 个项目文件读不出来。` */
  function cardNote(legacy) {
    const gs = groups(legacy);
    if (!gs.length) return '';
    return gs.map((g) => g.short).join('，') + '。';
  }

  /** 卡片上紧跟原因的那句怎么办：有没接上的硬盘就先说接上它；其余的去详情逐个看。 */
  function cardHint(legacy) {
    const gs = groups(legacy);
    if (!gs.length) return '';
    const drive = gs.find((g) => g.kind === 'volume');
    if (drive) return `接上「${drive.volume.name}」后点「全部重试」；不处理的话，下次启动会自动再试。逐个处理在详情里。`;
    return '每个的原因和处理办法在详情里；不需要的可以跳过。';
  }

  /** 一行：卡片副行、胶囊卡片的说明。 */
  function sub(legacy) {
    const c = counts(legacy);
    const dest = `导入到 ${legacy.dest}`;
    if (c.live) return `已导入 ${c.done}/${c.total} · ${dest}`;
    return [`已导入 ${c.done}`, c.pending ? `待处理 ${c.pending}` : null, c.skipped ? `已跳过 ${c.skipped}` : null, dest]
      .filter(Boolean).join(' · ');
  }

  /** 由 `legacy` 推出任务记录上那几格（状态、进度、阶段、副行）。在跑与否只看还有没有排队 / 在导入的项。 */
  function taskPatch(legacy) {
    const c = counts(legacy);
    const now = current(legacy);
    const live = c.live > 0;
    return {
      legacy,
      status: live ? 'running' : 'done',
      outcome: live ? null : 'done',
      pct: c.total ? Math.round((c.total - c.live) / c.total * 100) : 100,
      phase: live ? (legacy.waiting ? '等其他任务' : '导入中') : null,
      detail: live ? (legacy.waiting ? '其他任务在跑，导入先停一下，等它们结束后自动继续'
        : now ? `正在导入「${now.title}」` : null) : null,
      sub: sub(legacy),
      attention: !live && c.pending ? `${c.pending} 个待处理` : null,
      projectsDone: c.done, projectsTotal: c.total, dest: legacy.dest,
    };
  }

  /** Home 顶上那一条（导入是全局的事，不属于哪部视频，视频顶栏的任务胶囊不报它）：
      在跑时报进度与正在导入哪个；跑完留了没导入的，报结果与原因；都导入了就不出（toast 已经说过）。 */
  function banner(legacy) {
    const c = counts(legacy);
    if (c.live) {
      const now = current(legacy);
      return {
        state: 'running',
        title: `正在导入旧版项目 · ${c.total - c.live}/${c.total}`,
        detail: legacy.waiting ? '其他任务在跑，导入先停一下，等它们结束后自动继续'
          : [now ? `正在导入「${now.title}」` : null, `导入到 ${legacy.dest}`].filter(Boolean).join(' · '),
        pct: c.total ? Math.round((c.total - c.live) / c.total * 100) : 0,
      };
    }
    if (!c.pending) return null;
    return {state: 'result', title: `旧版项目导入结束：${c.done} 个已导入，${c.pending} 个没导入`, detail: cardNote(legacy), pct: null};
  }

  /** 一次导入（或一次重试）跑完时的 toast：`{text, tone, action}`，`action` 是 'result'（看原因）或 'open'（去 Space 看）。
      重试只报重试的那几个。 */
  function finishToast(legacy) {
    if (legacy.batch && legacy.batch.length) {
      const n = legacy.batch.length;
      const ok = legacy.items.filter((it) => legacy.batch.includes(it.path) && it.state === 'done').length;
      if (ok === n) return {text: `重试的 ${n} 个项目都已导入`, tone: 'positive', action: 'open'};
      return {text: ok ? `重试的 ${n} 个里 ${ok} 个已导入，${n - ok} 个还是没导入` : `重试的 ${n} 个还是没导入`,
        tone: 'neutral', action: 'result'};
    }
    const c = counts(legacy);
    if (!c.pending) return {text: `${c.done} 个旧版项目已导入`, tone: 'positive', action: 'open'};
    return {text: `导入结束：${c.done} 个已导入，${c.pending} 个没导入`, tone: 'neutral', action: 'result'};
  }

  const api = {DEMO_PROBLEMS, DEMO_PLACES, demoDrive, start, step, settle, retry, skip, unskip, counts, current, groups, itemNote, cardNote, cardHint, sub, taskPatch, banner, finishToast};
  if (typeof window !== 'undefined') window.BC_LEGACY_IMPORT_RUN = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
