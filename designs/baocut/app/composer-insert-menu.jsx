/* 输入框「+」菜单：Home 输入框与会话输入框共用（product-design §3.2.3）。
   ① 文件和文件夹  统一的本地附件入口；浏览器原型打开文件选择器，桌面端定稿后接系统文件与目录选择。
   ② 使用 Skill ▸  全部已添加的 skills，开着的在前；选一个 = 这条消息明确要求用它（输入框上挂一个可移除的 token，
      发送时提示词末尾带一行，见 model-agent-skills.js）。末尾「管理 Skills」去设置。
   ③ 最近的视频 ▸  最近活动的 8 部（BC_SPACE.recentMovies）。选了之后做什么由宿主决定；宿主不传 onMovie 就不显示这一项。
   附件如何接收由宿主的 onFiles 决定；引用使用 @ 补全，不再单设文件引用菜单项。
   `extra` 是宿主自己的菜单分区（会话里的「使用工具」），排在三项之后。 */
(function () {
  const {useRef} = React;
  const R = window.RSP;
  const A = R.AI;
  const K = window.BC_AGENT_SKILLS;
  const SP = window.BC_SPACE;
  const CATEGORY_ICON = {字幕: 'CloseCaptions', 剪辑: 'Cut', 发布: 'Publish', 品牌: 'Bookmark', 文稿: 'FileText', 社区: 'GlobeGrid'};
  const skillIcon = (category) => R.Icons[CATEGORY_ICON[category]] || R.Icons.Lightbulb;

  function ComposerInsertMenu({onSkill, onMovie, movies, onFiles, extra}) {
    const app = useApp();
    const input = useRef(null);
    const skills = K.menuItems(app.agentSkills);
    const recent = onMovie ? SP.recentMovies(movies || app.activeProjects, app.dirs, 8) : [];
    return <>
      <input hidden ref={input} type="file" multiple
        onChange={(e) => { const list = Array.from(e.target.files || []); e.target.value = ''; if (list.length) onFiles(list); }} />
      <A.InsertMenuButton>
        <R.MenuSection aria-label="添加">
          <R.Header>添加</R.Header>
          <R.MenuItem id="local-file" textValue="文件和文件夹" onAction={() => input.current?.click()}><R.Icons.Attach /><R.Text slot="label">文件和文件夹</R.Text></R.MenuItem>
          <R.SubmenuTrigger>
            <R.MenuItem id="skill" textValue="使用 Skill"><R.Icons.MagicWand /><R.Text slot="label">使用 Skill</R.Text></R.MenuItem>
            <R.Menu aria-label="使用 Skill">
              {skills.length ? <R.MenuSection aria-label="已添加的 Skills">
                {skills.map((s) => { const Icon = skillIcon(s.category); return <A.CommandMenuItem key={s.id} id={'skill-' + s.id} textValue={s.name} onAction={() => onSkill(s.id)}>
                  <Icon /><R.Text slot="label">{s.name}</R.Text><R.Text slot="description">{s.desc}</R.Text>
                </A.CommandMenuItem>; })}
              </R.MenuSection> : null}
              <R.MenuSection aria-label="管理">
                <R.MenuItem id="manage-skills" textValue="管理 Skills" onAction={() => app.go({r: 'settings', sec: 'skills'})}><R.Icons.Settings /><R.Text slot="label">管理 Skills</R.Text></R.MenuItem>
              </R.MenuSection>
            </R.Menu>
          </R.SubmenuTrigger>
          {recent.length ? <R.SubmenuTrigger>
            <R.MenuItem id="recent" textValue="最近的视频"><R.Icons.Filmstrip /><R.Text slot="label">最近的视频</R.Text></R.MenuItem>
            <R.Menu aria-label="最近的视频">
              {recent.map((m) => <A.CommandMenuItem key={m.id} id={'movie-' + m.id} textValue={m.title} onAction={() => onMovie(m.id)}>
                <R.Icons.Video /><R.Text slot="label">{m.title}</R.Text><R.Text slot="description">{m.desc}</R.Text>
              </A.CommandMenuItem>)}
            </R.Menu>
          </R.SubmenuTrigger> : null}
        </R.MenuSection>
        {extra}
      </A.InsertMenuButton>
    </>;
  }

  /* 选用的 skill 在输入框上的 token（画法同 Home 的模板 token）。 */
  function ComposerSkillToken({skill, onRemove}) {
    if (!skill) return null;
    return <div className="cins-token"><Ic n="skill" className="ic--16" /><span>Skill：{skill.name}</span>
      <IconBtn icon="close" size="xs" tip={'移除 Skill：' + skill.name} onClick={onRemove} /></div>;
  }

  /* Space 条目的引用标签（product-design §4.7）：种类图标 + 名字；带的是引用（名字、位置、种类），不是文件内容。
     `onRemove` 不给 = 已发出的消息里只读显示。 */
  function ComposerRefToken({reference, onRemove}) {
    if (!reference) return null;
    const R = window.RSP;
    const k = window.BC_SPACE && window.BC_SPACE.KINDS[reference.kind];
    const Icon = (k && R.Icons[k.icon]) || R.Icons.FileText;
    const where = [k ? k.label : null, reference.file].filter(Boolean).join(' · ');
    return <div className="cins-token" title={where}><Icon /><span>引用：{reference.name}</span>
      {onRemove ? <IconBtn icon="close" size="xs" tip={'移除引用：' + reference.name} onClick={onRemove} /> : null}</div>;
  }

  Object.assign(window, {ComposerInsertMenu, ComposerSkillToken, ComposerRefToken});
})();
