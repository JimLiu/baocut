// Two shots and a wipe, showing how the pieces fit together. It is a starting point for the mechanics, not a look:
// change the style, the places, the cast and the story for every film.
// Art names come from art.example.json; words.js is the transcribed narration.
const R = window.RigKit;
R.style({ font: '800 %px Title', ink: '#2b2d42', accent: '#d62828', tag: '#f4a261' });
R.assets(window.RIG);
R.voice(window.WORDS);

R.film({
  end: 9,
  build() {
    // ----- 1. A guide points at a sign; the wrong idea gets crossed out. -----
    const b = R.board('hall');
    const tSign = R.cue('built by'), tNo = R.cue('not quite');
    const sign = R.typed(b, 'BUILT BY\nFARMS', tSign, { size: 92 });
    const no = R.cross(b, tNo);
    const date = R.tag('1909', R.cue('in 1909', { word: 1 }));
    R.E('pop', tSign);
    R.shot('sign', 0, (t0, t1) => t => {
      R.camera(t, t0, t1, { x0: 860, x1: 980 });
      R.plate('hall');
      sign(t);
      no(t);
      R.actor('guide', t, {
        x: 1440, y: 1030, h: 680, seed: 3, sq: R.squash(t - tNo, 0.06),
        l: { aim: [b.x + b.w / 2, b.y + b.h / 2 - 30 * Math.sin(t * 3)], pose: 'point' },
        // A new gesture eases in on its word; undefined is the relaxed arm.
        r: R.swing(t, tNo, undefined, { at: [-0.3, 0.85], pose: 'open' }),
      });
      date(t);
    });

    R.wipe(R.cue('so who'));

    // ----- 2. Someone walks in and the guide reacts. -----
    const tWho = R.cue('so who'), tJump = R.cue('she did');
    R.shot('walk', tWho, (t0, t1) => t => {
      R.camera(t, t0, t1, { z0: 1.06, z1: 1.03 });
      R.plate('hall');
      const walked = (t - t0) * 220, h = 620;
      R.walker('visitor', t, { x: 260 + walked, y: 1040, h, phase: R.walkPhase('visitor', h, walked), seed: 9 });
      R.actor('guide', t, {
        x: 1500, y: 1030, h: 680, seed: 3, lift: R.hop(t, tJump, 0.42, 80),
        // The target moves with the walker, and this arm is on the side facing it.
        l: { aim: [260 + walked, 640], pose: 'point' },
        r: { at: [-0.7, 0.9], pose: 'fist', hold: { name: 'flask', h: 170, up: 0.46 } },
      });
      R.pop('!', 1560, 300, t, tJump);
    });
  },
});
