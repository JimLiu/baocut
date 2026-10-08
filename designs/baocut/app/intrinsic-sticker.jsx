/* Intrinsic SVG playback in the prototype: the browser samples SMIL; the SVG
   clock is paused and explicitly follows the project playhead (not wall time). */
(function () {
  const TAGS = new Set(['g','path','rect','circle','ellipse','line','polyline','polygon','defs','clipPath','mask','linearGradient','radialGradient','stop','animate','animateTransform']);
  const ATTRS = new Set(['id','d','points','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','width','height','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','opacity','transform','clip-path','clip-rule','clipPathUnits','offset','stop-color','stop-opacity','gradientUnits','attributeName','type','values','keyTimes','dur','begin','repeatCount','calcMode']);
  function tree(n, key, prefix) {
    if (!TAGS.has(n.localName)) return null;
    const props = {key};
    for (const a of n.attributes) if (ATTRS.has(a.name)) props[a.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a.name === 'id' ? prefix+a.value : a.value.replace(/url\(#([^)]+)\)/g, (_, id) => 'url(#'+prefix+id+')');
    return React.createElement(n.localName, props, Array.from(n.children).map((c,i) => tree(c,i,prefix)));
  }
  function IntrinsicSticker({raw, time, fillH, filter}) {
    const ref = React.useRef(null);
    const prefix = 'sticker-'+React.useId().replace(/[^a-zA-Z0-9_-]/g,'')+'-';
    const data = React.useMemo(() => {
      const root = new DOMParser().parseFromString(raw, 'image/svg+xml').documentElement;
      return {aspect: root.getAttribute('preserveAspectRatio'), viewBox: root.getAttribute('viewBox'), width: root.getAttribute('width'), height: root.getAttribute('height'), children: Array.from(root.children).map((c,i) => tree(c,i,prefix))};
    }, [raw,prefix]);
    React.useLayoutEffect(() => {
      const svg = ref.current;
      if (svg && svg.pauseAnimations && svg.setCurrentTime) {
        svg.pauseAnimations();
        svg.setCurrentTime(Math.floor((Number.isFinite(time) ? Math.max(0,time) : 0)*30+0.0000001)/30);
      }
    }, [raw,time]);
    return <svg ref={ref} viewBox={data.viewBox} width={data.width} height={data.height}
      preserveAspectRatio={fillH ? (data.aspect || 'none') : 'xMidYMid meet'} aria-hidden="true"
      style={{display:'block',width:'100%',height:fillH ? '100%' : 'auto',filter:filter || null}}>{data.children}</svg>;
  }
  window.IntrinsicSticker = IntrinsicSticker;
})();
