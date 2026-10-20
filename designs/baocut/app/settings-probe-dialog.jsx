/* 测试一个 API 提供方模型（product-design §7.6）：API 提供方详情的「能力与模型」与能力页的 API 提供方模型列表共用。
   语音识别发一段示例语音、文本生成发一句提示词、语音合成发一句示例文字；图像生成交给共用的自测对话框（image-gen.jsx ImageProbeDialog）。
   结果都是演示：下方分段切成功 / 鉴权失败 / 超时。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const C = () => window.BC_CLOUD_TTS;
  const IM = () => window.BC_CLOUD_IMAGE;
  const SAMPLE = 'Hello. This is a speech recognition test for BaoCut.';
  const TTS_SAMPLE = () => window.BC_TTS.sampleLine('zh', 'intro').text;
  const KIND_OF_CAP = {transcribe: 'stt', text: 'llm', tts: 'tts', image: 'image'};
  const TITLE = {stt: '测试语音识别', llm: '测试文本生成', tts: '测试语音合成'};
  const imgPrice = (pid, mid) => { const m = IM().modelOf(IM().modelId(pid, mid)); return m && m.price ? `每张约 $${m.price.normal.toFixed(2)}${m.price.k2 != null ? ` · 2K $${m.price.k2.toFixed(2)}` : ''}` : null; };

  /** probe = {providerId, providerName, modelId, cap}；onDone(result) 记下结果给行上的一句 */
  function ModelProbeDialog({probe, onClose, onDone}) {
    const [st, setSt] = useState({state: 'ready'});
    const [scenario, setScenario] = useState('ok');
    const timer = useRef(null);
    useEffect(() => { setSt({state: 'ready'}); setScenario('ok'); }, [probe && probe.providerId, probe && probe.modelId]);
    useEffect(() => () => clearTimeout(timer.current), []);
    if (!probe) return null;
    const kind = KIND_OF_CAP[probe.cap];
    const stop = () => { clearTimeout(timer.current); onClose(); };
    if (kind === 'image') {
      return <window.ImageProbeDialog open key={probe.providerId + '/' + probe.modelId}
        engine={{family: 'cloud', title: probe.providerName, modelId: probe.modelId, chip: 'Image', price: imgPrice(probe.providerId, probe.modelId),
          cap: IM().capabilities(IM().modelId(probe.providerId, probe.modelId))}}
        onClose={onClose} onDone={onDone} />;
    }
    const run = () => {
      setSt({state: 'running'});
      timer.current = setTimeout(() => {
        const r = scenario === 'ok'
          ? {state: 'ok', text: kind === 'stt' ? SAMPLE : kind === 'llm' ? 'OK' : null, audio: kind === 'tts', time: kind === 'tts' ? '1.8 s' : '1.2 s'}
          : {state: 'error', text: scenario === 'auth' ? '401 · 密钥无效或没有此模型的访问权限。' : '请求超时 · 检查网络或服务地址后重试。'};
        setSt(r);
        if (onDone) onDone(r);
      }, 1200);
    };
    const ttsCap = kind === 'tts' ? C().capabilities(probe.providerId, probe.modelId) : null;
    return <Dialog open title={TITLE[kind]} onClose={stop}
      footer={<><Btn variant="secondary" onClick={stop}>{st.state === 'running' ? '停止等待' : '关闭'}</Btn>
        <Btn variant="accent" disabled={st.state === 'running'} onClick={run}>{st.state === 'running' ? '测试中…' : st.state === 'ready' ? '开始测试' : '重新测试'}</Btn></>}>
      <div className="cloud-probe">
        <div className="row gap8"><b className="t-title-sm">{probe.providerName}</b><Chip tone="neutral">{window.BC_VENDORS.CAP_LABEL[probe.cap]}</Chip></div>
        <div className="t-mono t-detail">{probe.modelId}</div>
        <Card layer className="cloud-sample">
          <b className="t-title-sm">{kind === 'stt' ? '测试语音 · English' : kind === 'tts' ? '测试文字 · 简体中文' : '测试提示词'}</b>
          {kind === 'stt' ? <><audio controls preload="metadata" src="assets/cloud-test.wav" aria-label="试听测试语音" /><p className="t-detail">{SAMPLE}</p></>
            : kind === 'tts' ? <><p className="t-body-sm">{TTS_SAMPLE()}</p><p className="t-detail">音色 · 默认（{(C().defaultVoice(probe.providerId, 'zh') || {name: '由对方缺省'}).name}）{(ttsCap || {speed: true}).speed ? ' · 语速 1.0×' : ''}</p></>
            : <p className="t-body-sm">Reply with OK.</p>}
        </Card>
        <p className="t-detail">{kind === 'stt' ? '把这段示例语音发给所选模型，检查是否返回识别文本。不会读取你的视频音频。'
          : kind === 'tts' ? `把这句文字发给所选模型合成，检查能否返回音频。这次约 ${C().chars(TTS_SAMPLE())} 字。`
          : '向所选模型发送上面的提示词，检查是否返回生成文本。'}用的是这家的首选账号，提供方可能按用量计费。停止等待不会撤回已经发送的请求。</p>
        <Card className="cloud-result" role="status" aria-live="polite">
          <b className={cx('t-title-sm', st.state === 'error' && 't-negative')}>{({ready: '等待开始', running: kind === 'stt' ? '正在发送语音并等待识别…' : kind === 'tts' ? '正在发送文字并等待音频…' : '正在等待模型回复…',
            ok: `测试通过 · ${st.time || '1.2 s'} · 演示结果`, error: '测试失败 · 演示结果'})[st.state]}</b>
          {st.text ? <p className="t-body-sm">{st.text}</p> : null}
          {st.audio && st.state === 'ok' ? <div className="cloud-sample"><audio controls preload="metadata" src="assets/cloud-test.wav" aria-label="试听合成结果" />
            <p className="t-detail">2.9 秒 · {C().chars(TTS_SAMPLE())} 字 · 结果存在 tts-preview/，不进视频</p></div> : null}
        </Card>
        <div className="row gap8 cloud-demo-row"><span className="t-detail-xs grow">原型结果演示</span>
          <Segmented size="s" value={scenario} onChange={(x) => st.state !== 'running' && setScenario(x)}
            items={[{k: 'ok', label: '成功'}, {k: 'auth', label: '鉴权失败'}, {k: 'timeout', label: '超时'}]} /></div>
      </div>
    </Dialog>;
  }
  /** 行上的一句测试结论 */
  const probeVerdict = (r) => (!r ? '' : r.state === 'ok' ? `测试通过 · ${r.time || ''} · 演示` : r.text);

  Object.assign(window, {ModelProbeDialog, probeVerdict});
})();
