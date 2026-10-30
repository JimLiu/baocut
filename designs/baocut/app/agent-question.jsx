/* Agent 向你提问（产品设计 §6.6「提问」；只在 App 入口加载）。

   一道或几道选择题，Agent 停下来等。每题一组单选或多选，末尾是「其他」与输入框（S2 RadioGroup /
   Checkbox / TextField）；没有选项的是填空题，只有一个多行输入框。选项可以带预览（图、视频或音频），
   放在单选或勾选框下面、不进它的标签：点图等于选这一项，视频、音频是正文播放器，只播不选。
   「发送回答」要每题都有答案；「跳过」按拒绝结束，Agent 自己拿主意；
   直接在输入框发消息也算回答（store 的 sendAgent 把卡片记成「已在输入框回复」）。
   回答之后卡片收成一行记录（和允许卡一样留在线程里），展开是每题与答案。草稿规则在 model-agent-question.js。 */
(function () {
  const {useState} = React;
  const Q = window.BC_AGENT_QUESTION;
  const R = window.RSP;

  /* 选项的预览。演示数据里 `src` / `poster` 代替真实界面经 media.resolve 取到的地址；取不到（没有 src）就不画。
     播放器在 App 入口里晚于本文件加载，渲染时再取。 */
  function OptionPreview({p, name, onSelect}) {
    if (!p || !p.src) return null;
    if (p.kind === 'image') {
      return <button type="button" className="aquest__thumb" tabIndex={-1} onClick={onSelect}><img src={p.src} alt={name} /></button>;
    }
    const media = {id: `question:${p.path}`, name: p.path.split('/').pop(), file: p.path, previewSrc: p.src, poster: p.poster};
    const Video = window.MediaVideoSurface, Audio = window.MediaAudioPreview;
    if (p.kind === 'video' && Video) return <div className="aquest__player"><Video file={media} /></div>;
    if (p.kind === 'audio' && Audio) return <div className="aquest__player aquest__player--audio"><Audio file={media} inline /></div>;
    return null;
  }

  /* 多选：原型的 window.RSP 没有导出 CheckboxGroup，用一组受控的 Checkbox 放进 role="group" */
  function QuestionBlock({q, picked, other, onPick, onWrite}) {
    const head = <>
      {q.header ? <span className="aquest__chip">{q.header}</span> : null}
      <p className="aquest__text">{q.question}</p>
    </>;
    if (Q.isFillIn(q)) {
      return <div className="aquest__q">{head}<R.TextArea aria-label={q.question} placeholder="写下你的回答" value={other} onChange={onWrite} /></div>;
    }
    const body = (o) => <span className="aquest__opt"><span>{o.label}</span>{o.description ? <span className="aquest__desc">{o.description}</span> : null}</span>;
    const toggle = (v, on) => onPick(on ? picked.concat([v]) : picked.filter((x) => x !== v));
    const select = (v) => (q.multiSelect ? toggle(v, !picked.includes(v)) : onPick([v]));
    const choices = q.options.map((o) => ({value: o.label, label: body(o), preview: o.preview}))
      .concat(q.allowOther === false ? [] : [{value: Q.OTHER, label: '其他'}]);
    const item = (c, control) => (c.preview
      ? <div key={c.value} className="aquest__item">{control}<OptionPreview p={c.preview} name={c.value} onSelect={() => select(c.value)} /></div>
      : <React.Fragment key={c.value}>{control}</React.Fragment>);
    return (
      <div className="aquest__q">
        {head}
        {q.multiSelect ? (
          <div className="aquest__checks" role="group" aria-label={q.question}>
            {choices.map((c) => item(c, <R.Checkbox isSelected={picked.includes(c.value)} onChange={(on) => toggle(c.value, on)}>{c.label}</R.Checkbox>))}
            <span className="aquest__desc">可多选</span>
          </div>
        ) : (
          <R.RadioGroup aria-label={q.question} description="选一个" value={picked[0] || null} onChange={(v) => onPick([v])}>
            {choices.map((c) => item(c, <R.Radio value={c.value}>{c.label}</R.Radio>))}
          </R.RadioGroup>
        )}
        {picked.includes(Q.OTHER) ? <R.TextField aria-label="其他" placeholder="写下你的回答" value={other} onChange={onWrite} autoFocus /> : null}
      </div>
    );
  }

  function AgentQuestionMsg({m, sid}) {
    const app = useApp();
    const [draft, setDraft] = useState({picked: {}, other: {}});
    const qs = m.questions || [];
    const title = qs.length > 1 ? `Agent 有 ${qs.length} 个问题要问你` : 'Agent 有个问题要问你';
    if (m.state !== 'pending') {
      return (
        <BCDisclosure className="awork" title={<> <Ic n="help" className="ic--14" /> {Q.stateLabel(m.state)} · {(qs[0] && qs[0].header) || '提问'} </>}>
          {qs.map((q) => (
            <div key={q.id} className="aquest__q">
              <p className="aquest__text">{q.question}</p>
              {m.state === 'answered' ? <p className="aquest__answer">{Q.answerText(m.answers, q.id)}</p> : null}
            </div>
          ))}
        </BCDisclosure>
      );
    }
    const answers = Q.draftAnswers(qs, draft);
    const pick = (id, values) => setDraft((d) => ({...d, picked: {...d.picked, [id]: values}}));
    const write = (id, text) => setDraft((d) => ({...d, other: {...d.other, [id]: text}}));
    return (
      <div className="aquest" role="group" aria-label={title}>
        <div className="aquest__hd"><Ic n="help" className="ic--16" /><b>{title}</b></div>
        {qs.map((q) => (
          <QuestionBlock key={q.id} q={q} picked={draft.picked[q.id] || []} other={draft.other[q.id] || ''}
            onPick={(v) => pick(q.id, v)} onWrite={(t) => write(q.id, t)} />
        ))}
        <div className="aquest__acts">
          <Btn variant="accent" size="s" disabled={!answers} onClick={() => app.answerQuestion(sid, m.id, answers)}>发送回答</Btn>
          <Btn variant="quiet" size="s" onClick={() => app.answerQuestion(sid, m.id, null)}>跳过</Btn>
        </div>
        <p className="aquest__hint">也可以直接在输入框回复。</p>
      </div>
    );
  }

  Object.assign(window, {AgentQuestionMsg});
})();
