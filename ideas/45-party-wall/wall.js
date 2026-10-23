// Party Wall — the neighbour behind the wall, as a pure state machine.
//
// No DOM, no audio, no timers. The page feeds it your knocks and the clock; it hands back a
// list of events (your knocks, their knocks, phase changes, matches, the end). Everything the
// README claims about pacing, stages, the ending and determinism lives in this file, and
// wall.test.mjs checks it against the numbers in T below.
//
// Loads as a plain <script> (window.PartyWall) and as CommonJS (require('./wall.js')).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PartyWall = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // All times in milliseconds.
  const T = Object.freeze({
    PHRASE_GAP: 1400, // your silence that ends a phrase
    FIRST_DELAY: 3000, // extra thinking time before the very first answer
    REPLY_DELAY: 900, // thinking time before every later answer
    PHRASE_MAX: 10, // knocks remembered from one phrase (the last ten)
    PLAIN_ECHOES: 2, // replies 2 and 3 are plain echoes; from reply 4 a tag is added
    TAG_GAP: 600, // pause between the echo and the two-knock tag
    TAG_INTERVAL: 170, // between the two tag knocks
    JITTER: 0.07, // echo intervals are scaled by 1 ± up to this
    GAIN_JITTER: 0.1,
    QUIET_FOR_BEAT: 4000, // your silence before they offer their beat
    REPLIES_BEFORE_BEAT: 5, // the beat can be offered once this many replies have started
    REPLIES_FORCE_BEAT: 7, // after this many replies the next answer is the beat regardless
    BEAT_INTERVAL: 900,
    BEAT_COUNT: 12, // beats per offering
    BEAT_TOLERANCE: 180, // ± window for a knock to count as on the beat
    LAG_MAX: 200, // the late edge of that window also stretches by the page's reported lag, up to this
    MATCHES_TO_END: 4, // consecutive on-beat beats that end the piece
    ENDED_REPLY_DELAY: 40, // after the end, every knock is answered this soon
    GAIN: Object.freeze({ first: 0.35, echo: 0.55, ask: 0.6, beat: 0.6, final: 0.9, ended: 0.8 }),
  });

  const PHASES = Object.freeze(['idle', 'listening', 'replying', 'beat', 'ending', 'ended']);

  // mulberry32: small, seedable, good enough for jitter.
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(s) {
    if (typeof s === 'number' && Number.isFinite(s)) return s >>> 0;
    const str = String(s == null ? 1 : s);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createWall(opts) {
    const options = opts || {};
    const seed = hashSeed(options.seed);
    const rand = rng(seed);

    let phase = 'idle';
    let phrase = []; // your knocks in the current phrase: {t, x, y}
    let lastKnock = null; // your most recent knock {t, x, y}, any phase
    let replies = 0; // replies that have started (their first knock was emitted)
    let queue = []; // their scheduled knocks, sorted by t
    let replyKind = null; // kind of the reply currently in the queue
    let replyStarted = false;
    let quietSince = null; // when the last thing they said ended
    let beat = null; // { t0, k, matched: [], closed: [], streak, offering }
    let offerings = 0;
    let endedAt = null;
    let currentTime = 0;
    let scheduledReplyAt = null;
    let lag = clampLag(options.lag);

    // How late the page's sound reaches the player, in ms: their knocks are played on the first
    // frame after their time, and then the device adds its audio output latency. A knock is judged
    // against the beat as it was scheduled, so this much is added to the late edge of each beat
    // window (never to the early edge, so a wrong figure can only make the window more lenient).
    function clampLag(ms) {
      return typeof ms === 'number' && Number.isFinite(ms) ? Math.min(T.LAG_MAX, Math.max(0, Math.round(ms))) : 0;
    }

    function jitter(amount) {
      return 1 + (rand() * 2 - 1) * amount;
    }

    function theirKnock(t, x, y, gain, clarity, extra) {
      return Object.assign({ type: 'knock', who: 'them', t, x, y, gain, clarity }, extra || {});
    }

    // Build the knocks of a reply to the given phrase, starting at time `at`.
    function planReply(kind, ph, at) {
      const last = ph[ph.length - 1];
      const out = [];
      if (kind === 'first') {
        out.push(theirKnock(at, last.x, last.y, T.GAIN.first, 0, { kind }));
        return out;
      }
      const gain = kind === 'ask' ? T.GAIN.ask : T.GAIN.echo;
      let t = at;
      for (let i = 0; i < ph.length; i++) {
        if (i > 0) t += (ph[i].t - ph[i - 1].t) * jitter(T.JITTER);
        out.push(theirKnock(t, ph[i].x, ph[i].y, gain * jitter(T.GAIN_JITTER), 0, { kind, index: i }));
      }
      if (kind === 'ask') {
        t += T.TAG_GAP;
        out.push(theirKnock(t, last.x, last.y, gain, 0, { kind, tag: true, index: ph.length }));
        t += T.TAG_INTERVAL;
        out.push(theirKnock(t, last.x, last.y, gain, 0, { kind, tag: true, index: ph.length + 1 }));
      }
      return out;
    }

    function replyKindFor(n) {
      // n = how many replies have already started
      if (n === 0) return 'first';
      if (n <= T.PLAIN_ECHOES) return 'echo';
      return 'ask';
    }

    function startBeat(at, out) {
      phase = 'beat';
      offerings++;
      // The lag is fixed for the whole offering, so changing it never moves a window already open.
      beat = { t0: at, k: 0, matched: new Array(T.BEAT_COUNT).fill(false), closed: 0, streak: 0, lag };
      queue = [];
      replyKind = 'beat';
      out.push({ type: 'phase', phase, t: at });
    }

    function beatTime(k) {
      return beat.t0 + k * T.BEAT_INTERVAL;
    }

    // The last moment a knock still counts for beat k. The window closes strictly after it, so a
    // knock stamped exactly on either edge counts.
    function closeTime(k) {
      return beatTime(k) + T.BEAT_TOLERANCE + beat.lag;
    }

    // Advance the clock to `now`, emitting everything due. Times must not go backwards.
    function step(now) {
      const out = [];
      if (typeof now !== 'number' || !Number.isFinite(now) || now < currentTime) now = currentTime;
      // Process in time order: pending scheduled things, pending reply starts, beat windows.
      // Every pass emits something or moves the clock on, so the loop always ends; the guard only
      // catches a bug. Left alone after the fifth reply they offer their beat for ever, 25 passes
      // per 14 s offering, so the limit grows with the stretch of time being caught up (a tab left
      // in the background for hours) rather than being a fixed count.
      const limit = 10000 + 4 * Math.ceil((now - currentTime) / T.BEAT_INTERVAL);
      let guard = 0;
      for (;;) {
        if (++guard > limit) throw new Error('party-wall: step did not converge');
        // Candidate next event times.
        let nextT = Infinity;
        let what = null;
        if (queue.length && queue[0].t <= now && queue[0].t < nextT) {
          nextT = queue[0].t;
          what = 'queued';
        }
        if (phase === 'listening' && phrase.length && scheduledReplyAt != null && scheduledReplyAt <= now && scheduledReplyAt < nextT) {
          nextT = scheduledReplyAt;
          what = 'reply';
        }
        if (phase === 'listening' && !phrase.length && quietSince != null && replies >= T.REPLIES_BEFORE_BEAT) {
          const at = quietSince + T.QUIET_FOR_BEAT;
          if (at <= now && at < nextT) {
            nextT = at;
            what = 'offer';
          }
        }
        if (phase === 'beat') {
          if (beat.k < T.BEAT_COUNT) {
            const bt = beatTime(beat.k);
            if (bt <= now && bt < nextT) {
              nextT = bt;
              what = 'beat';
            }
          }
          if (beat.closed < beat.k) {
            const ct = closeTime(beat.closed);
            if (ct < now && ct < nextT) {
              nextT = ct;
              what = 'close';
            }
          }
        }
        if (what == null) break;
        currentTime = nextT;

        if (what === 'queued') {
          const k = queue.shift();
          if (!replyStarted && (phase === 'replying')) {
            replyStarted = true;
            replies++;
          }
          out.push(k);
          if (k.final) {
            phase = 'ended';
            endedAt = k.t;
            out.push({ type: 'phase', phase, t: k.t });
            out.push({ type: 'end', t: k.t });
          } else if (phase === 'replying' && !queue.length) {
            // Reply finished: back to listening, and the clock of quiet starts here.
            phase = 'listening';
            phrase = [];
            quietSince = k.t;
            replyKind = null;
            out.push({ type: 'phase', phase, t: k.t });
          }
        } else if (what === 'reply') {
          const at = scheduledReplyAt;
          scheduledReplyAt = null;
          if (replies >= T.REPLIES_FORCE_BEAT) {
            phrase = [];
            startBeat(at, out);
          } else {
            replyKind = replyKindFor(replies);
            queue = planReply(replyKind, phrase, at);
            replyStarted = false;
            phase = 'replying';
            out.push({ type: 'phase', phase, t: at, kind: replyKind });
          }
        } else if (what === 'offer') {
          startBeat(quietSince + T.QUIET_FOR_BEAT, out);
        } else if (what === 'beat') {
          const k = beat.k++;
          const pos = lastKnock || { x: 0.5, y: 0.5 };
          const clarity = Math.min(1, beat.streak / T.MATCHES_TO_END);
          const gain = T.GAIN.beat + (T.GAIN.final - T.GAIN.beat) * clarity;
          out.push(theirKnock(beatTime(k), pos.x, pos.y, gain, clarity, { kind: 'beat', index: k }));
        } else if (what === 'close') {
          const k = beat.closed++;
          const ct = closeTime(k);
          if (beat.matched[k]) beat.streak++;
          else beat.streak = 0;
          out.push({ type: 'beat', t: ct, index: k, matched: beat.matched[k], streak: beat.streak });
          if (beat.streak >= T.MATCHES_TO_END) {
            // The end: one more knock from them on the next beat, clear, as if there were no wall.
            const pos = lastKnock || { x: 0.5, y: 0.5 };
            phase = 'ending';
            queue = [theirKnock(beatTime(k + 1), pos.x, pos.y, T.GAIN.final, 1, { kind: 'final', final: true })];
            out.push({ type: 'phase', phase, t: ct });
          } else if (beat.closed >= T.BEAT_COUNT) {
            // Offering over without an ending. Listen again; offer again after more quiet.
            phase = 'listening';
            phrase = [];
            quietSince = ct;
            beat = null;
            out.push({ type: 'phase', phase, t: ct });
          }
        }
      }
      currentTime = now;
      return out;
    }

    // Your knock at time t, position (x, y) in [0, 1]. Returns the events this causes,
    // including your own knock, after first advancing the clock to t.
    function knock(t, x, y) {
      const out = step(t);
      if (typeof t !== 'number' || !Number.isFinite(t) || t < currentTime) t = currentTime; // the clock never runs backwards
      const px = typeof x === 'number' ? Math.min(1, Math.max(0, x)) : 0.5;
      const py = typeof y === 'number' ? Math.min(1, Math.max(0, y)) : 0.5;
      const k = { t, x: px, y: py };
      lastKnock = k;
      out.push({ type: 'knock', who: 'you', t, x: px, y: py, gain: 1, clarity: 1 });

      if (phase === 'ended') {
        queue.push(theirKnock(t + T.ENDED_REPLY_DELAY, px, py, T.GAIN.ended, 1, { kind: 'ended' }));
        queue.sort((a, b) => a.t - b.t);
        return out;
      }
      if (phase === 'ending') return out; // the last knock is already on its way
      if (phase === 'beat') {
        // On the beat? From BEAT_TOLERANCE before an open beat to its close time (BEAT_TOLERANCE
        // after it, plus the lag). Windows never overlap, so at most one beat qualifies. The first
        // beat of an offering has no early side in practice: before it starts they are listening,
        // and a knock then is an ordinary phrase knock.
        let best = -1;
        for (let i = beat.closed; i < T.BEAT_COUNT; i++) {
          if (t >= beatTime(i) - T.BEAT_TOLERANCE && t <= closeTime(i)) {
            best = i;
            break;
          }
        }
        if (best >= 0) {
          const fresh = !beat.matched[best];
          beat.matched[best] = true;
          if (fresh) out.push({ type: 'match', t, index: best, streak: beat.streak + 1 });
        } else {
          out.push({ type: 'miss', t });
        }
        return out;
      }
      if (phase === 'replying') {
        // Interrupted: they stop and listen.
        const dropped = queue.length;
        queue = [];
        replyKind = null;
        phase = 'listening';
        phrase = [];
        out.push({ type: 'phase', phase, t, interrupted: true, dropped });
      }
      if (phase === 'idle') {
        phase = 'listening';
        out.push({ type: 'phase', phase, t });
      }
      phrase.push(k);
      if (phrase.length > T.PHRASE_MAX) phrase = phrase.slice(-T.PHRASE_MAX);
      const delay = replies === 0 ? T.FIRST_DELAY : T.REPLY_DELAY;
      scheduledReplyAt = t + T.PHRASE_GAP + delay;
      return out;
    }

    function state() {
      return {
        phase,
        seed,
        replies,
        offerings,
        phraseLength: phrase.length,
        pending: queue.length,
        replyKind,
        streak: beat ? beat.streak : 0,
        beatIndex: beat ? beat.k : -1,
        nextBeatAt: beat && beat.k < T.BEAT_COUNT ? beatTime(beat.k) : null,
        quietSince,
        scheduledReplyAt: phase === 'listening' && phrase.length ? scheduledReplyAt : null,
        endedAt,
        lag,
        time: currentTime,
      };
    }

    // The page's lag in ms (see clampLag). It takes effect from the next offering of the beat.
    function setLag(ms) {
      lag = clampLag(ms);
    }

    return { knock, step, state, setLag, T };
  }

  return { createWall, T, PHASES, hashSeed, rng };
});
