/* 「声音」一组 —— 带声音的元素共用（Agent 剪辑工具缺口方案 G11a）：音量（旁边读 dB）、音量包络（只读）、
   音频淡入淡出、人声响起时压低（闪避）。原型里只有视频元素挂它（`VideoProps` 的「播放」拆成「播放」与
   「声音」两段）；时间轴上的音频 / 音乐行是夹具布尔位、不是元素，不造假元素页——App / Web 的音频元素
   按这同一份规格做（台账）。

   写出的字段：
     音量    原型样式袋 `vol`（百分数，= 文档 `volume` × 100）；dB 只读，按 20·log10 算，0 = −∞
     包络    `keyframes.volume`，只读回显「N 个点 · 清除」；有包络时它取代静态音量
     闪避    `duck`：打开只写 `{under}`，压低 / 起落动过才写 `depth` / `attack` / `release`；关掉写 null
   范围与缺省以 BCF 规范 §19 与 `bcut spec` 为准；这里的缺省读数与滑杆上限是示意（model-keyframes.js）。 */
(function () {
  const {useState} = React;
  const K = window.BC_KF;
  const E = window.BC_EL;

  /* 压在什么之下：人声（按文稿里的说话区间）＋ 这个项目里真有的几条音频轨。轨 id 是示意写法，
     真 id 以时间轴文档的 `tracks[].id` 为准。 */
  function underOptions(ctx) {
    const out = [{k: 'speech', label: '人声', sub: '按文稿里有人说话的区间'}];
    if (ctx.hasMusic) out.push({k: 'music', label: '音乐轨'});
    (ctx.dubs || []).forEach((d) => out.push({k: 'dub:' + d.lang, label: '配音 · ' + (d.langName || d.lang)}));
    return out;
  }

  function DuckCard({ctx, duck, write}) {
    const [open, setOpen] = useState(false);
    const [adv, setAdv] = useState(false);
    const on = K.duckOn(duck);
    const opts = underOptions(ctx);
    const cur = on ? (opts.find((o) => o.k === duck.under) || {k: duck.under, label: duck.under}) : null;
    const hasTranscript = (ctx.cues || []).length > 0;
    const set = (patch) => write(K.duckSet(duck, patch));
    const custom = on && ['depth', 'attack', 'release'].some((k) => duck[k] != null);
    return (
      <div className={window.cx('stcard', open && 'stcard--open')}>
        <div className="hd">
          <Ic n="vol2" className="ic--16" />人声响起时压低
          <div className="push"><Switch on={on} ariaLabel="人声响起时压低"
            onChange={(x) => write(x ? K.duckSet(null, {under: 'speech'}) : null)} /></div>
        </div>
        {on ? (
          <div className="bd">
            <PRow label="压在">
              <Picker size="s" value={cur.label} open={open} onClick={() => setOpen((v) => !v)}
                onClose={() => setOpen(false)} className="grow">
                <Menu>
                  {opts.map((o) => (
                    <MenuItem key={o.k} label={o.label} sub={o.sub} check={o.k === duck.under}
                      onClick={() => { setOpen(false); set({under: o.k}); }} />
                  ))}
                </Menu>
              </Picker>
            </PRow>
            {K.duckIdle(duck, hasTranscript) ? (
              <div className="hint hint--warn hint--tight">
                这部视频还没有文稿，认不出哪里有人说话——现在压低不会生效。先转录，或改压在某条轨之下。
              </div>
            ) : null}
            <ValueRow label="压低" value={K.duckField(duck, 'depth')} min={K.DUCK_SLIDER.depth[0]}
              max={K.DUCK_SLIDER.depth[1]} hardMax={Infinity} step={1} unit="dB"
              onChange={(x) => set({depth: x})} />
            <BCAction type="button" className="kfadv" onClick={() => setAdv((v) => !v)} aria-expanded={adv}>
              <Ic n={adv ? 'chevdown' : 'chevright'} className="ic--14" />高级
            </BCAction>
            {adv ? (
              <>
                <ValueRow label="压下" value={K.duckField(duck, 'attack')} min={K.DUCK_SLIDER.attack[0]}
                  max={K.DUCK_SLIDER.attack[1]} hardMax={Infinity} step={0.01} unit="s"
                  onChange={(x) => set({attack: x})} />
                <ValueRow label="回升" value={K.duckField(duck, 'release')} min={K.DUCK_SLIDER.release[0]}
                  max={K.DUCK_SLIDER.release[1]} hardMax={Infinity} step={0.05} unit="s"
                  onChange={(x) => set({release: x})} />
              </>
            ) : null}
            <div className="kfduck__ft">
              <span className="grow">{custom ? '已改动的项按你填的值' : '未改动的项用缺省值'}</span>
              {custom ? (
                <BCAction type="button" className="kfrow__clr"
                  onClick={() => set({depth: null, attack: null, release: null})}>恢复缺省</BCAction>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function SoundSection({ctx, id, v, set}) {
    const doc = (ctx.elDocs || {})[id] || {};
    const kf = doc.keyframes || null;
    const vol = v.vol == null ? 0 : v.vol;
    const fade = !!v.fadeOn;
    const env = K.count(kf, 'volume');
    return (
      <>
        <SecHead>声音</SecHead>
        <div className="sec">
          <ValueRow label="音量" value={vol} min={0} max={K.VOL_SLIDER_MAX} hardMax={Infinity} unit="%"
            extra={K.fmtDb(vol / 100)} onChange={(x) => set({vol: x})} />
          {env ? (
            <>
              <div className="kfrow kfrow--ro">
                <span className="lab">音量包络</span>
                <Ic n="keyframe" className="ic--14 kfrow__kf" />
                <span className="kfrow__n">{env} 个点</span>
                <span className="kfrow__dot">·</span>
                <BCAction type="button" className="kfrow__clr"
                  onClick={() => ctx.setElDoc(id, {keyframes: K.clearProp(kf, 'volume')})}>清除</BCAction>
              </div>
              <div className="kfsec__note">有包络时音量按包络走，上面的音量不生效。</div>
            </>
          ) : null}
        </div>
        <div className="stcard">
          <div className="hd">
            <Ic n="audio" className="ic--16" />音频淡入淡出
            <div className="push"><Switch on={fade} onChange={(x) => set({fadeOn: x})} /></div>
          </div>
          {fade ? (
            <div className="bd">
              <ValueRow label="淡入" value={v.fadeIn == null ? 1 : v.fadeIn} min={0} max={E.FADE_MAX}
                step={0.1} unit="s" onChange={(x) => set({fadeIn: x})} />
              <ValueRow label="淡出" value={v.fadeOut == null ? 1 : v.fadeOut} min={0} max={E.FADE_MAX}
                step={0.1} unit="s" onChange={(x) => set({fadeOut: x})} />
            </div>
          ) : null}
        </div>
        <DuckCard ctx={ctx} duck={doc.duck || null} write={(d) => ctx.setElDoc(id, {duck: d})} />
      </>
    );
  }

  Object.assign(window, {SoundSection});
})();
