/* BaoCut 原型 — Agent 向你提问（产品设计 §6.6「提问」）里「算出来的东西」：window.BC_AGENT_QUESTION。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   一张提问卡是一道或几道选择题（单选或多选），末尾可以选「其他」自己写。卡片上的草稿是
   `{picked: {题号: [选中的 label]}, other: {题号: 自己写的}}`；每题都有答案才能发送。
   回答之后卡片收成一行记录：已回答 / 已跳过 / 已在输入框回复 / 已停止。 */
(function () {
  /** 「其他」这一项在草稿里的值（不会和选项 label 撞上）。 */
  const OTHER = '\u0000other';

  const STATE_LABELS = {answered: '已回答', skipped: '已跳过', byMessage: '已在输入框回复', stopped: '已停止'};

  /** 草稿 → 答案：`{题号: [答案]}`。有一题没答（或选了「其他」却没写）就是 null。单选只取第一个。 */
  function draftAnswers(questions, draft) {
    const picked = (draft && draft.picked) || {};
    const other = (draft && draft.other) || {};
    const answers = {};
    for (const q of questions || []) {
      const chosen = (picked[q.id] || []).slice(0, q.multiSelect ? undefined : 1);
      const values = [];
      for (const v of chosen) {
        const text = v === OTHER ? String(other[q.id] || '').trim() : v;
        if (text && !values.includes(text)) values.push(text);
      }
      if (!values.length || (chosen.includes(OTHER) && !String(other[q.id] || '').trim())) return null;
      answers[q.id] = values;
    }
    return answers;
  }

  /** 一题的答案念成一句：多个用顿号连。 */
  function answerText(answers, id) {
    const values = (answers && answers[id]) || [];
    return values.length ? values.join('、') : '没有回答';
  }

  /** 收起后那一行的状态词。 */
  function stateLabel(state) {
    return STATE_LABELS[state] || '';
  }

  /** 答完之后 Agent 接着说的那句（演示）：把每题的答案复述一遍。 */
  function replyFor(questions, answers) {
    const pairs = (questions || []).map((q) => `${q.header || q.question}：${answerText(answers, q.id)}`);
    return `收到——${pairs.join('；')}。我照这个往下做，做好了再给你看。`;
  }

  /** 会话列表里最后一条是提问时的摘要。 */
  function pendingSummary(m) {
    const first = m && m.questions && m.questions[0];
    return `等你回答 · ${first ? first.header || first.question : '提问'}`;
  }

  window.BC_AGENT_QUESTION = {OTHER, draftAnswers, answerText, stateLabel, replyFor, pendingSummary};
})();
