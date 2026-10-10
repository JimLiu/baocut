/* AI 工具 Tab 的纯模型（product-design §5.10，2026-10-09）：
   · 工具列表分批：第一批只列从文稿出发的三组（整理文稿 / 写作 / 发布），翻译与画面之后搬入；
   · 工具页的提示词模板：意图句 + 几行固定约束，预填进输入框，用户可改。语言、风格、篇幅、视角不再是
     下拉——都写在模板里，改一句话比翻一个下拉更直接，也让新用户看见「会发出去什么」；
   · 直接调模型时发给模型的上下文包（文稿、章节、译文、附件）折成一行人话；
   · 交给 Agent 时发到哪条会话：缺省新开一条、把这部视频作为上下文（同一条长会话每次都要重发整段历史，
     prompt cache 过期后是额外成本；一件事一条会话也更好找），可改成接着这部视频当前的会话。
   无 React、无 DOM，`node --test` 直接跑。 */
(function () {
  const GROUPS_NOW = ['整理文稿', '写作', '发布'];
  const GROUPS_LATER = ['翻译', '画面'];
  const LATER_NOTE = '翻译字幕、翻译配音、智能裁剪与剪成短视频还在字幕、音频、视频面板里，之后搬到这里。';

  /* 每个工具各配一个内置 skill（§5.10、§6.9）：提示词框默认挂着它。摘掉 = 只按提示词做；还可以再挂别的已添加 skill。 */
  const TOOL_SKILL = {
    retranscribe: 'transcribe-captions', polish: 'transcript-polish', chapters: 'chaptering', speakers: 'speaker-labeling',
    cleanup: 'talking-head-cut', translate: 'subtitle-translation', stale: 'subtitle-translation',
    summary: 'video-summary', blog: 'blog-from-video', title: 'title-and-description', desc: 'title-and-description',
    cover: 'cover-and-title', shortscut: 'shorts-slicing',
  };
  /** 工具页打开时默认挂的 skill id 列表：这个工具的内置 skill 还在列表里就挂它（关着也挂——点选不看开关，§6.9）。 */
  function defaultSkills(tool, list) {
    const id = TOOL_SKILL[tool];
    return id && (list || []).some((s) => s.id === id) ? [id] : [];
  }

  /* 每个工具页顶上一句：会不会改视频。新用户第一眼要知道的是「按下去会发生什么」。 */
  const EFFECT = {
    polish: '会改文稿：完成后应用，一步撤销',
    chapters: '会改章节：完成后应用，一步撤销',
    speakers: '先给你确认，应用后才写进视频',
    retranscribe: '会换掉这一范围的文稿：完成后应用，一步撤销',
    cleanup: '只写建议，不直接剪；在文稿里逐条决定',
    stale: '只重译过期的那几句，其余不动',
    summary: '不改视频：结果给你读、拷走',
    blog: '不改视频：结果给你读、拷走',
    title: '不改视频：挑一个选用',
    desc: '不改视频：结果给你读、拷走',
    cover: '不改视频：挑一张选用',
  };

  /* 固定约束：以前是下拉（语言 / 风格 / 篇幅 / 视角），现在是模板里的几行字。 */
  function standing(tool, o) {
    const lang = o.lang ? `用${o.lang}` : '语言与文稿相同';
    const md = `用 Markdown 写，${lang}。`;
    switch (tool) {
      case 'summary': return [md, '正文先给结论，再列要点；每条要点带时间码（mm:ss）。', '篇幅适中，三到五段。'];
      case 'blog': return [md, '视角按视频来源判断：我自己的视频以作者口吻写，别人的视频以观众视角写。', '风格平实，不用营销腔。'];
      case 'title': return [lang + '。', '每个候选一行，后面跟一句理由；角度各不相同，最后推荐一个。'];
      case 'desc': return [md, '带章节时间码和一行标签。'];
      case 'cover': return ['封面上的字跟文稿的语言。'];
      case 'polish': return ['不改写我的表达，也不删内容；只修可以确定是笔误的地方。'];
      case 'chapters': return ['按话题聚合，每章一个短标题。'];
      default: return [];
    }
  }

  /** 预填进输入框的模板：第一行意图句（intentPrompt 的那一句），下面几行固定约束。
      `intent` 由 BC_AGENT.intentPrompt 翻好传进来；范围、勾选项等已经折在里面。 */
  function template(tool, intentText, o) {
    const lines = [String(intentText || '').trim()].concat(standing(tool, o || {}));
    return lines.filter(Boolean).join('\n');
  }

  /** 直接调模型时发给模型的上下文：按工具决定带什么，折成人话。 */
  function contextPack(tool, o) {
    const c = o || {};
    const items = [];
    const paras = c.paras || 0;
    const words = c.words ? ` · 约 ${c.words.toLocaleString('zh-CN')} 字` : '';
    if (tool === 'cover') items.push({k: 'frames', label: '关键帧', detail: `${c.frames || 0} 张`});
    if (paras) items.push({k: 'transcript', label: c.scope ? `文稿 · ${c.scope}` : '文稿', detail: `${paras} 段${words} · 带时间码与说话人`});
    if (c.chapters) items.push({k: 'chapters', label: '章节', detail: `${c.chapters} 章`});
    if (tool === 'stale' && c.stale) items.push({k: 'translation', label: '译文', detail: `过期的 ${c.stale} 句及前后各一句`});
    if (c.attachments) items.push({k: 'attachments', label: '附件', detail: `${c.attachments} 个`});
    if (c.skills && c.skills.length) items.push({k: 'skills', label: 'Skill', detail: c.skills.join('、')});
    return items;
  }
  function contextLine(items) {
    if (!items.length) return '发给模型的：只有上面的提示词';
    return '发给模型的：提示词 + ' + items.map((i) => `${i.label} ${i.detail}`).join(' · ');
  }

  /** 交给 Agent 发到哪条会话。`sessions` 最新在前；只认挂在这部视频上的会话。 */
  function sessionOptions(sessions, projId) {
    const cur = (sessions || []).find((s) => s.project === projId && (s.messages || []).length);
    const opts = [{k: 'new', label: '新会话', sub: '把这部视频作为上下文；一件事一条会话，不重发整段历史'}];
    if (cur) {
      const n = cur.messages.length;
      opts.push({k: 'current', sid: cur.id, label: `接着「${cur.title || '这部视频的会话'}」`, sub: `已有 ${n} 条消息 · 重发历史，prompt cache 过期后多花钱`});
    }
    return {options: opts, dflt: 'new'};
  }

  /** 主按钮下那行 hint：按下去会去哪、谁来做。 */
  function hint(o) {
    const c = o || {};
    if (c.agent) {
      const where = c.session === 'current' ? '发到这部视频当前的会话' : '新开一条会话';
      return `${where}，这部视频作为上下文；Agent 读完视频、写入前都会先问你。`;
    }
    const who = c.model ? `直接调 ${c.model}` : '直接调模型';
    return `${who}，不经过对话；${c.readonly ? '结果给你读、挑、拷走，不写进视频' : '完成即应用，可一键撤销'}。${c.cloud ? '云端模型按用量计费。' : '本机模型，不出本机。'}`;
  }

  Object.assign(window, {BC_AIPROMPT: {GROUPS_NOW, GROUPS_LATER, LATER_NOTE, EFFECT, TOOL_SKILL, defaultSkills, standing, template, contextPack, contextLine, sessionOptions, hint}});
})();
