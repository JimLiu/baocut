/* Agent 向你提问（产品设计 §6.6「提问」；只在 App 入口加载）。

   一道或几道选择题，Agent 停下来等。每题一组单选或多选，末尾是「其他」与输入框（S2 RadioGroup /
   Checkbox / TextField）。「发送回答」要每题都有答案；「跳过」按拒绝结束，Agent 自己拿主意；
   直接在输入框发消息也算回答（store 的 sendAgent 把卡片记成「已在输入框回复」）。
   回答之后卡片收成一行记录（和允许卡一样留在线程里），展开是每题与答案。草稿规则在 model-agent-question.js。 */
(function () {
  const {useState} = React;
  const Q = window.BC_AGENT_QUESTION;
  const R = window.RSP;

  /* 多选：原型的 window.RSP 没有导出 CheckboxGroup，用一组受控的 Checkbox 放进 role="group" */
  function QuestionBlock({q, picked, other, onPick, onWrite}) {
    const body = (o) => <span className="aquest__opt"><span>{o.label}</span>{o.description ? <span className="aquest__desc">{o.description}</span> : null}</span>;
    const toggle = (v, on) => onPick(on ? picked.concat([v]) : picked.filter((x) => x !== v));
    const choices = (q.options || []).map((o) => ({value: o.label, label: body(o)})).concat([{value: Q.OTHER, label: '其他'}]);
    return (
      <div className="aquest__q">
        {q.header ? <span className="aquest__chip">{q.header}</span> : null}
        <p className="aquest__text">{q.question}</p>
        {q.multiSelect ? (
          <div className="aquest__checks" role="group" aria-label={q.question}>
            {choices.map((c) => <R.Checkbox key={c.value} isSelected={picked.includes(c.value)} onChange={(on) => toggle(c.value, on)}>{c.label}</R.Checkbox>)}
            <span className="aquest__desc">可多选</span>
          </div>
        ) : (
          <R.RadioGroup aria-label={q.question} description="选一个" value={picked[0] || null} onChange={(v) => onPick([v])}>
            {choices.map((c) => <R.Radio key={c.value} value={c.value}>{c.label}</R.Radio>)}
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
