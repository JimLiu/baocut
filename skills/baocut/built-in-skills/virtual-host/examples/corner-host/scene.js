// Corner host: a transparent full frame with only the host's bust in the lower right; import it onto the top visual track.
// pack/ comes from host-pack.mjs, host-track.js from lipsync.mjs, host-kit.js is copied from the skill's host-kit/.
// x is the centre of the bottom edge, y the bottom edge (on the frame's lower edge so the cut stays hidden while swaying), h the drawn height.
const host = HostKit.host(window.HOST_PACK, window.HOST_TRACK);
HostKit.film({
  draw(ctx, t) {
    host.draw(ctx, t, { x: 1660, y: 1080, h: 440 });
  },
});
