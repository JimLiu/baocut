/* 导出弹层的「响度」一节 —— 剧情短片 §5.3 / §8（2026-09-24）。
   视频页与音频页各放一份，**缺省关**：关着按项目里的混音原样导出；打开后整片混音统一到
   目标响度（缺省 −16 LUFS），真峰值不超过上限（缺省 −1.2 dBTP），两个数都能改。
   对应内核 `bcut export --loudness --true-peak`。响度要整片量一遍，所以开着时视频页不走
   光速修正——说明句只在有光速修正的表面（`BC_SURFACE.flashFix`，App）提这一点。
   算的东西在 `model-loudness.js`，这里只画和接事件；状态由弹层持有，两页共用一份。 */
(function () {
  const {useState} = React;
  const L = window.BC_LOUD;

  function ExportLoudness({value, onChange}) {
    const [pop, setPop] = useState(null);           // 'lufs' | 'peak'
    const v = value || L.DEFAULT;
    const set = (patch) => onChange(Object.assign({}, v, patch));
    const toggle = (k) => setPop((p) => (p === k ? null : k));
    return (
      <>
        <div className="cpsec">响度</div>
        <div className="xquick">
          <div className="xquick__f">
            <span className="xquick__lb">响度标准化</span>
            <Switch ariaLabel="响度标准化" on={v.on} onChange={(on) => set({on})} />
          </div>
          {v.on ? (
            <>
              <div className="xquick__f">
                <span className="xquick__lb">目标</span>
                <Picker size="s" value={L.fmtDb(v.lufs) + ' LUFS'} open={pop === 'lufs'}
                  onClick={() => toggle('lufs')} onClose={() => setPop(null)} popWidth={160}>
                  <Menu>
                    {L.choices(L.LUFS_CHOICES, v.lufs).map((x) => (
                      <MenuItem key={x} label={L.fmtDb(x) + ' LUFS'} on={x === v.lufs}
                        sub={x === L.DEFAULT.lufs ? '缺省' : null}
                        onClick={() => { set({lufs: x}); setPop(null); }} />
                    ))}
                  </Menu>
                </Picker>
              </div>
              <div className="xquick__f">
                <span className="xquick__lb">峰值上限</span>
                <Picker size="s" value={L.fmtDb(v.truePeak) + ' dBTP'} open={pop === 'peak'}
                  onClick={() => toggle('peak')} onClose={() => setPop(null)} popWidth={160} popAlign="right">
                  <Menu>
                    {L.choices(L.TRUE_PEAK_CHOICES, v.truePeak).map((x) => (
                      <MenuItem key={x} label={L.fmtDb(x) + ' dBTP'} on={x === v.truePeak}
                        sub={x === L.DEFAULT.truePeak ? '缺省' : null}
                        onClick={() => { set({truePeak: x}); setPop(null); }} />
                    ))}
                  </Menu>
                </Picker>
              </div>
            </>
          ) : null}
        </div>
        <div className="xnote">{L.note(v, !!window.BC_SURFACE.flashFix)}</div>
      </>
    );
  }

  Object.assign(window, {ExportLoudness});
})();
