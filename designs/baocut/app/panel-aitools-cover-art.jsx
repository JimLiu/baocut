/* 做封面 —— 演示画面（§15.11）。关键帧缩略图与封面候选都用代码画成 SVG，不往仓库里放图片。
   这里画的是**视频画布里的内容**（别人看到的封面），不是 App chrome：颜色固定、不随明暗主题翻转，
   所以用的是一组固定色值（登记在 _ds_conformance.json 的 allow 里），不用 token。
   画面按 BC_WRITING.SCENES 的四种：主持人 / 两人 / 屏幕 / 三人；封面按四条路线各画一种样子。 */
(function () {
  const W = window.BC_WRITING;

  /* 画面内容的固定色（不是界面颜色） */
  const P = {
    night: '#141821', slate: '#232A36', steel: '#3A4556', ink: '#0B0D12', white: '#FFFFFF',
    skin1: '#E8B894', skin2: '#C98E6B', skin3: '#F0CDB0', hair: '#2A2320',
    blue: '#2F6FDE', coral: '#E0553C', green: '#2BA37A',
    paper: '#F4F6FA', rule: '#C9D1DE', amber: '#FFB020', cloud: '#9AA3B2',
    mint: '#3DDC97', cream: '#FFF4E0', grape: '#5B3FD1', sky: '#6C8CFF',
  };
  const BGS = [[P.steel, P.night], [P.grape, P.night], [P.slate, P.ink]];
  const FLAT = [P.cream, P.sky, P.amber];

  /** 画幅 → SVG 画布尺寸（按比例；实际显示大小由外层 CSS 定） */
  function dims(ratio) {
    const [a, b] = String(ratio || '16:9').split(':').map(Number);
    if (!a || !b) return {w: 320, h: 180};
    return a >= b ? {w: 320, h: Math.round((320 * b) / a)} : {w: Math.round((320 * a) / b), h: 320};
  }

  /* 一个人：头、头发、上身。s 是头的半径。 */
  function Person({x, y, s, shirt, skin, flat}) {
    const line = flat ? {stroke: P.ink, strokeWidth: Math.max(1.5, s * 0.12)} : null;
    return (
      <g>
        <rect x={x - s * 1.7} y={y - s * 1.1} width={s * 3.4} height={s * 2.4} rx={s * 1.1} fill={shirt} {...line} />
        <circle cx={x} cy={y - s * 1.9} r={s} fill={skin} {...line} />
        <path d={`M ${x - s} ${y - s * 2} a ${s} ${s} 0 0 1 ${s * 2} 0 q ${-s} ${-s * 0.5} ${-s * 2} 0 z`} fill={P.hair} />
      </g>
    );
  }

  /* 笔记本屏幕上的转录文稿：一行高亮，上方一条声波 */
  function Laptop({x, y, w, flat}) {
    const h = w * 0.62;
    const line = flat ? {stroke: P.ink, strokeWidth: Math.max(2, w * 0.018)} : null;
    const rows = [0.92, 0.7, 0.84, 0.58, 0.76];
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={w * 0.03} fill={P.slate} {...line} />
        <rect x={x + w * 0.04} y={y + w * 0.04} width={w * 0.92} height={h - w * 0.08} rx={w * 0.015} fill={P.paper} />
        {Array.from({length: 18}, (_, i) => {
          const bh = (Math.sin(i * 1.7) * 0.5 + 0.6) * h * 0.12;
          return <rect key={i} x={x + w * 0.08 + i * w * 0.046} y={y + h * 0.2 - bh / 2} width={w * 0.022} height={bh} rx={w * 0.01} fill={P.blue} />;
        })}
        {rows.map((r, i) => (
          <rect key={i} x={x + w * 0.08} y={y + h * (0.36 + i * 0.11)} width={w * 0.84 * r} height={h * 0.05} rx={h * 0.02}
            fill={i === 2 ? P.amber : P.rule} />
        ))}
        <rect x={x - w * 0.08} y={y + h} width={w * 1.16} height={w * 0.05} rx={w * 0.02} fill={P.steel} {...line} />
      </g>
    );
  }

  /** 视频里的一帧（关键帧、真实画面路线的底图） */
  function Scene({scene, w, h, flat, seed}) {
    const s = Math.min(w, h) * 0.085;
    const floor = h * 0.98;
    const bg = BGS[(seed || 0) % BGS.length];
    const gid = `sg-${scene}-${seed || 0}-${w}x${h}${flat ? 'f' : ''}`;
    const people = {
      host: [{x: w * 0.44, shirt: P.blue, skin: P.skin1, k: 1.25}],
      duo: [{x: w * 0.3, shirt: P.coral, skin: P.skin2, k: 1}, {x: w * 0.7, shirt: P.blue, skin: P.skin1, k: 1}],
      trio: [{x: w * 0.22, shirt: P.green, skin: P.skin3, k: 0.9}, {x: w * 0.5, shirt: P.blue, skin: P.skin1, k: 0.95}, {x: w * 0.78, shirt: P.coral, skin: P.skin2, k: 0.9}],
    }[scene];
    return (
      <g>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={flat ? FLAT[(seed || 0) % FLAT.length] : bg[0]} />
            <stop offset="1" stopColor={flat ? FLAT[(seed || 0) % FLAT.length] : bg[1]} />
          </linearGradient>
        </defs>
        <rect width={w} height={h} fill={`url(#${gid})`} />
        {scene === 'screen' || !people
          ? <Laptop x={w * (flat ? 0.14 : 0.2)} y={h * (flat ? 0.1 : 0.16)} w={w * (flat ? 0.72 : 0.6)} flat={flat} />
          : (
            <g>
              {flat ? null : <rect x={0} y={h * 0.34} width={w} height={h * 0.02} fill={P.steel} />}
              {people.map((p, i) => <Person key={i} x={p.x} y={floor} s={s * p.k * (flat ? 1.35 : 1)} shirt={p.shirt} skin={p.skin} flat={flat} />)}
              {scene === 'host' ? <g>
                <rect x={w * 0.6} y={h * 0.55} width={s * 0.35} height={h * 0.45} fill={P.cloud} />
                <rect x={w * 0.6 - s * 0.35} y={h * 0.47} width={s * 1.05} height={s * 1.3} rx={s * 0.5} fill={P.ink} />
              </g> : null}
              {scene === 'duo' ? <rect x={w * 0.12} y={h * 0.86} width={w * 0.76} height={h * 0.14} fill={P.ink} opacity="0.85" /> : null}
            </g>
          )}
      </g>
    );
  }

  /* 全新生成：一个比喻——笔记本上浮着一段声波，旁边一朵划掉的云 */
  function Metaphor({w, h, seed}) {
    const gid = `mg-${seed}-${w}x${h}`;
    const lw = Math.min(w, h) * 0.9;
    return (
      <g>
        <defs>
          <radialGradient id={gid} cx="0.35" cy="0.3" r="0.9">
            <stop offset="0" stopColor={seed % 2 ? P.sky : P.grape} />
            <stop offset="1" stopColor={P.night} />
          </radialGradient>
        </defs>
        <rect width={w} height={h} fill={`url(#${gid})`} />
        {Array.from({length: 24}, (_, i) => {
          const bh = (Math.sin(i * 0.9) * 0.5 + 0.55) * h * 0.3;
          return <rect key={i} x={w / 2 - lw * 0.45 + i * lw * 0.038} y={h * 0.4 - bh / 2} width={lw * 0.02} height={bh} rx={lw * 0.01} fill={P.mint} opacity={0.55 + (i % 3) * 0.15} />;
        })}
        <g opacity="0.8">
          <circle cx={w * 0.8} cy={h * 0.2} r={Math.min(w, h) * 0.08} fill={P.cloud} />
          <circle cx={w * 0.86} cy={h * 0.22} r={Math.min(w, h) * 0.06} fill={P.cloud} />
          <circle cx={w * 0.75} cy={h * 0.23} r={Math.min(w, h) * 0.055} fill={P.cloud} />
          <line x1={w * 0.7} y1={h * 0.32} x2={w * 0.93} y2={h * 0.1} stroke={P.coral} strokeWidth={Math.min(w, h) * 0.025} strokeLinecap="round" />
        </g>
        <Laptop x={w / 2 - lw * 0.28} y={h * 0.62} w={lw * 0.56} />
      </g>
    );
  }

  /* 代码绘制：一张对比条形图（画面里的字跟封面的语言走） */
  const CHART = {zh: ['上传 + 排队', '本机'], en: ['Upload + queue', 'On this laptop']};
  function Chart({w, h, lang}) {
    const lb = CHART[lang] || CHART[W.demoLang(lang).code];
    const m = Math.min(w, h);
    const x0 = w * 0.1, bw = w * 0.8, bh = m * 0.12;
    return (
      <g>
        <rect width={w} height={h} fill={P.ink} />
        {Array.from({length: 6}, (_, i) => <line key={i} x1={x0 + (bw * i) / 5} y1={h * 0.1} x2={x0 + (bw * i) / 5} y2={h * 0.62} stroke={P.slate} strokeWidth="1" />)}
        <text x={x0} y={h * 0.16} fill={P.cloud} fontSize={m * 0.06} fontWeight="700">{lb[0]}</text>
        <rect x={x0} y={h * 0.2} width={bw} height={bh} rx={bh * 0.2} fill={P.coral} />
        <text x={x0} y={h * 0.2 + bh + m * 0.1} fill={P.cloud} fontSize={m * 0.06} fontWeight="700">{lb[1]}</text>
        <rect x={x0} y={h * 0.2 + bh + m * 0.14} width={bw * 0.38} height={bh} rx={bh * 0.2} fill={P.mint} />
      </g>
    );
  }

  /* 封面上的字：代码排，不由模型画（重设计 §7.2 ⑤）。粗描边，缩小了也读得出。 */
  function Words({w, h, text, sub, ratio}) {
    if (!text) return null;
    const tall = h > w;
    const fs = (tall ? w * 0.12 : h * 0.14);
    const y = tall ? h * 0.72 : h * 0.8;
    const stroke = {stroke: P.ink, strokeWidth: fs * 0.16, paintOrder: 'stroke', strokeLinejoin: 'round'};
    return (
      <g>
        <rect x="0" y={y - fs * 1.4} width={w} height={h - y + fs * 1.4} fill={P.ink} opacity="0.35" />
        {sub ? <text x={w * 0.06} y={y - fs * 1.05} fill={P.amber} fontSize={fs * 0.42} fontWeight="700" {...stroke} strokeWidth={fs * 0.1}>{sub}</text> : null}
        <text x={w * 0.06} y={y} fill={P.white} fontSize={fs} fontWeight="800" {...stroke}>{text}</text>
      </g>
    );
  }

  /** 一张封面候选。c = {base, scene, text, sub, ratio, seed}；lang 决定画面里的字。 */
  function CoverArt({c, lang, className}) {
    const {w, h} = dims(c.ratio);
    const seed = c.seed || 0;
    let body;
    if (c.base === 'generated') body = <Metaphor w={w} h={h} seed={seed} />;
    else if (c.base === 'drawn') body = <Chart w={w} h={h} lang={lang} />;
    else body = <Scene scene={c.scene || 'host'} w={w} h={h} flat={c.base === 'restyled'} seed={seed} />;
    return (
      <svg className={className} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" role="img"
        aria-label={c.idea || ''}>
        {body}
        <Words w={w} h={h} text={c.text} sub={c.sub} ratio={c.ratio} />
      </svg>
    );
  }

  /** 关键帧条上的一帧（项目画面按 16:9 画） */
  function FrameArt({f, className}) {
    return (
      <svg className={className} viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" role="img" aria-label={W.mmss(f.t)}>
        <Scene scene={f.scene} w={160} h={90} seed={Math.round(f.t) % 3} />
      </svg>
    );
  }

  Object.assign(window, {BC_COVERART: {CoverArt, FrameArt, dims}});
})();
