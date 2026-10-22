/*
 * autogram.js — the language core of Autogram Forge.
 *
 * An autogram is a sentence that truthfully inventories its own letters:
 *   "This sentence contains three a's, ..., and one z."
 * Every number word you write changes the very counts you are writing about, so a true
 * sentence is a fixed point of a jumpy, discontinuous map. This file holds:
 *   - English number words (0..999) and letter counting,
 *   - a renderer that turns claimed counts into a sentence,
 *   - a checker that reads the claims back out of any sentence and audits them,
 *   - a randomized fixed-point solver that searches for a true sentence.
 *
 * It is a classic script (not an ES module) so index.html also works when opened straight
 * from the file system. In the browser it defines globalThis.Autogram; under Node it also
 * sets module.exports.
 */
(function (root) {
  'use strict';

  var A = 97; // char code of 'a'
  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
  var MAX_N = 999;
  var TOTAL = 26; // index of the optional "N letters" claim in solver state

  // Built from char codes so the source stays plain ASCII.
  var DASHES = '\\-' + String.fromCharCode(0x2010) + '-' + String.fromCharCode(0x2015);
  var COMBINING = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  var DASH_RE = new RegExp('[' + DASHES + ']', 'g');
  var LQ = String.fromCharCode(0x2018, 0x201c); // curly opening quotes
  var RQ = String.fromCharCode(0x2019, 0x201d); // curly closing quotes / apostrophe

  // ---------------------------------------------------------------- number words
  var ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen'];
  var TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

  /** English cardinal for 0..999. hundredAnd: "one hundred and five" vs "one hundred five". */
  function numberWord(n, hundredAnd) {
    if (typeof n !== 'number' || !(n >= 0 && n <= MAX_N) || n !== Math.floor(n)) {
      throw new RangeError('numberWord: integers 0..' + MAX_N + ' only, got ' + n);
    }
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
    var rest = n % 100;
    var head = ONES[Math.floor(n / 100)] + ' hundred';
    if (!rest) return head;
    return head + (hundredAnd ? ' and ' : ' ') + numberWord(rest, hundredAnd);
  }

  /** Read an English number phrase back ("Twenty-three", "one hundred and five"). -1 if it is not one. */
  function parseNumberWord(text) {
    var words = String(text).toLowerCase().replace(DASH_RE, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return -1;
    var hundreds = 0, cur = 0, seen = false, lastKind = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var o = ONES.indexOf(w), t = TENS.indexOf(w);
      if (o >= 0) {
        if (lastKind === 'one' || (lastKind === 'ten' && o >= 10) || (lastKind === 'ten' && o === 0)) return -1;
        cur += o; seen = true; lastKind = 'one';
      } else if (t >= 2) {
        if (lastKind === 'one' || lastKind === 'ten') return -1;
        cur += t * 10; seen = true; lastKind = 'ten';
      } else if (w === 'hundred' && lastKind === 'one' && cur > 0 && cur < 10 && !hundreds) {
        hundreds = cur * 100; cur = 0; lastKind = 'hundred';
      } else if (w === 'and' && lastKind === 'hundred') {
        lastKind = 'and';
      } else return -1;
    }
    if (!seen || lastKind === 'and') return -1;
    return hundreds + cur;
  }

  // ---------------------------------------------------------------- letters
  /**
   * Fold text to the letters a-z that get counted. Accents are stripped (é -> e) by NFKD
   * decomposition, which also splits ligatures such as U+FB01 into f + i. Everything else
   * (digits, punctuation, æ, ß, emoji, other scripts) is not one of the 26 and is ignored.
   */
  function foldLetters(str) {
    var s = String(str == null ? '' : str);
    if (s.normalize) s = s.normalize('NFKD');
    return s.replace(COMBINING, '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function countLetters(str) {
    var out = new Int32Array(26);
    var s = foldLetters(str);
    for (var i = 0; i < s.length; i++) out[s.charCodeAt(i) - A]++;
    return out;
  }

  /** The letters (as an a-z string) that occur in at least one number word 1..999. */
  function lettersInNumberWords(hundredAnd) {
    var seen = {};
    for (var n = 1; n <= MAX_N; n++) {
      var f = foldLetters(numberWord(n, hundredAnd));
      for (var i = 0; i < f.length; i++) seen[f[i]] = true;
    }
    return ALPHABET.split('').filter(function (c) { return seen[c]; }).join('');
  }

  // ---------------------------------------------------------------- the sentence template
  var DEFAULTS = {
    prefix: 'This sentence contains',
    suffix: '.',
    list: 'auto',        // 'auto': the letters that occur; 'all': all 26 (a pangram); 'custom': a fixed set
    custom: 'aeiou',     // letters to list when list === 'custom'
    conj: 'and',         // word before the last item: 'and', '&', or '' (commas only)
    oxford: true,        // comma before the conjunction
    apostrophe: true,    // "three a's" vs "three as" (no effect on counts)
    hundredAnd: true,    // "one hundred and five" vs "one hundred five"
    total: false,        // also claim the total: "... contains one hundred and two letters: ..."
    bonus: false         // 'auto' only: may the search add self-sufficient claims like "one q"?
  };

  function makeSpec(opts) {
    var s = {};
    var k;
    for (k in DEFAULTS) s[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (opts[k] !== undefined && Object.prototype.hasOwnProperty.call(DEFAULTS, k)) s[k] = opts[k];
    s.prefix = String(s.prefix);
    s.suffix = String(s.suffix);
    if (['auto', 'all', 'custom'].indexOf(s.list) < 0) throw new Error("list must be 'auto', 'all' or 'custom'");
    if (['and', '&', ''].indexOf(s.conj) < 0) throw new Error("conj must be 'and', '&' or ''");
    var customSet = foldLetters(s.custom);
    s.custom = ALPHABET.split('').filter(function (c) { return customSet.indexOf(c) >= 0; }).join('');
    if (s.list === 'custom' && !s.custom) throw new Error('a custom list needs at least one letter');
    s.oxford = !!s.oxford; s.apostrophe = !!s.apostrophe; s.hundredAnd = !!s.hundredAnd;
    s.total = !!s.total; s.bonus = !!s.bonus;
    return s;
  }

  /** Indices of the letters the sentence makes claims about, given claimed counts. */
  function listedLetters(spec, counts) {
    var out = [];
    for (var i = 0; i < 26; i++) {
      if (spec.list === 'all') out.push(i);
      else if (spec.list === 'custom') { if (spec.custom.indexOf(ALPHABET[i]) >= 0) out.push(i); }
      else if (counts[i] > 0) out.push(i);
    }
    return out;
  }

  function itemText(spec, letterIndex, n) {
    var plural = n === 1 ? '' : (spec.apostrophe ? "'s" : 's');
    return numberWord(n, spec.hundredAnd) + ' ' + ALPHABET[letterIndex] + plural;
  }

  function totalText(spec, n) {
    return numberWord(n, spec.hundredAnd) + (n === 1 ? ' letter:' : ' letters:');
  }

  /**
   * Render the sentence as segments so a UI can style each claim.
   * kinds: 'text' (prefix, glue, suffix), 'total' ({n}), 'item' ({letter, n}).
   * counts: 26 claimed counts; total: the claimed letter total (used when spec.total).
   */
  function renderSegments(spec, counts, total) {
    var segs = [];
    var prefix = spec.prefix.replace(/\s+$/, '');
    var letters = listedLetters(spec, counts);
    var head = [];
    if (prefix) head.push({ kind: 'text', text: prefix });
    if (spec.total) head.push({ kind: 'total', n: total, text: totalText(spec, total) });
    head.forEach(function (s, idx) {
      segs.push(s);
      if (idx < head.length - 1 || letters.length) segs.push({ kind: 'text', text: ' ' });
    });
    for (var k = 0; k < letters.length; k++) {
      var i = letters[k];
      if (k > 0) {
        var glue;
        if (k < letters.length - 1 || !spec.conj) glue = ', ';
        else if (letters.length === 2) glue = ' ' + spec.conj + ' ';
        else glue = (spec.oxford ? ', ' : ' ') + spec.conj + ' ';
        segs.push({ kind: 'text', text: glue });
      }
      segs.push({ kind: 'item', letter: ALPHABET[i], n: counts[i], text: itemText(spec, i, counts[i]) });
    }
    if (spec.suffix) segs.push({ kind: 'text', text: spec.suffix });
    return segs;
  }

  function render(spec, counts, total) {
    return renderSegments(spec, counts, total).map(function (s) { return s.text; }).join('');
  }

  // ---------------------------------------------------------------- the checker
  var NUM_ALT = '(?:' + ONES.concat(TENS.slice(2), ['hundred', 'and']).join('|') + ')';
  var NUM_PHRASE = NUM_ALT + '(?:[\\s' + DASHES + ']+' + NUM_ALT + ')*';
  var CLAIM_RE = new RegExp('\\b(' + NUM_PHRASE + ')\\s+[\'"' + LQ + ']?([a-z])[\'"' + RQ + ']?(?:' + RQ[0] + "s|'s|s)?(?![a-z])", 'gi');
  var TOTAL_RE = new RegExp('\\b(' + NUM_PHRASE + ')\\s+letters?\\b', 'gi');

  function readPhrase(raw) {
    // "and one z": the conjunction belongs to the list, not the number.
    return parseNumberWord(raw.replace(/^(and[\s]+)+/i, ''));
  }

  /**
   * Read the letter-count claims out of any sentence ("<number words> <letter>", with an
   * optional 's / s plural) and an optional "<number words> letters" total, then audit them.
   * Heuristic by design: ordinary prose like "one a day" also reads as a claim.
   */
  function check(sentence) {
    var text = String(sentence == null ? '' : sentence);
    var counts = countLetters(text);
    var letterTotal = 0;
    for (var t = 0; t < 26; t++) letterTotal += counts[t];
    var claims = [];
    var m, n;
    CLAIM_RE.lastIndex = 0;
    while ((m = CLAIM_RE.exec(text))) {
      n = readPhrase(m[1]);
      if (n < 0) continue;
      var letter = m[2].toLowerCase();
      var lead = /^(?:and\s+)+/i.exec(m[0]);
      var skip = lead ? lead[0].length : 0;
      claims.push({ letter: letter, n: n, actual: counts[letter.charCodeAt(0) - A], text: m[0].slice(skip), index: m.index + skip });
    }
    var totals = [];
    TOTAL_RE.lastIndex = 0;
    while ((m = TOTAL_RE.exec(text))) {
      n = readPhrase(m[1]);
      var lead2 = /^(?:and\s+)+/i.exec(m[0]);
      var skip2 = lead2 ? lead2[0].length : 0;
      if (n >= 0) totals.push({ n: n, actual: letterTotal, text: m[0].slice(skip2), index: m.index + skip2 });
    }
    var seen = {};
    var dup = [];
    claims.forEach(function (c) { if (seen[c.letter] && dup.indexOf(c.letter) < 0) dup.push(c.letter); seen[c.letter] = true; });
    var wrong = claims.filter(function (c) { return c.n !== c.actual; });
    var wrongTotals = totals.filter(function (c) { return c.n !== c.actual; });
    var unlisted = [];
    for (var i = 0; i < 26; i++) if (counts[i] > 0 && !seen[ALPHABET[i]]) unlisted.push(ALPHABET[i]);
    var ok = claims.length > 0 && wrong.length === 0 && wrongTotals.length === 0 && dup.length === 0;
    return {
      claims: claims,
      totals: totals,
      counts: counts,
      letterTotal: letterTotal,
      wrong: wrong,
      wrongTotals: wrongTotals,
      duplicates: dup,
      unlisted: unlisted,   // letters present but never claimed (a complete autogram has none)
      ok: ok,               // every claim it makes is true
      complete: ok && unlisted.length === 0
    };
  }

  /**
   * Audit a sentence built by render() directly against the claims it was built from,
   * without parsing prose. Returns { ok, sentence, actual, letterTotal, wrong: [letter|'total'] }.
   */
  function verify(spec, counts, total) {
    spec = makeSpec(spec);
    var sentence = render(spec, counts, total);
    var actual = countLetters(sentence);
    var letterTotal = 0;
    for (var t = 0; t < 26; t++) letterTotal += actual[t];
    var wrong = [];
    var letters = listedLetters(spec, counts);
    letters.forEach(function (i) { if (counts[i] !== actual[i]) wrong.push(ALPHABET[i]); });
    if (spec.list === 'auto') {
      for (var i = 0; i < 26; i++) if (actual[i] > 0 && !(counts[i] > 0)) wrong.push(ALPHABET[i]);
    }
    if (spec.total && total !== letterTotal) wrong.push('total');
    return { ok: letters.length > 0 && wrong.length === 0, sentence: sentence, actual: actual, letterTotal: letterTotal, wrong: wrong };
  }

  /** Letters whose claim is "one x" and whose only occurrence is inside that claim. */
  function loneLetters(spec, counts, total) {
    var actual = countLetters(render(spec, counts, total));
    return listedLetters(spec, counts).filter(function (i) {
      return counts[i] === 1 && actual[i] === 1;
    }).map(function (i) { return ALPHABET[i]; });
  }

  // ---------------------------------------------------------------- the solver
  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Searches for claims v with v = count(render(v)).
   *
   * State: v[0..25] claimed letter counts, v[26] the claimed total (if spec.total), and
   * a[0..25] the real letter counts of the sentence those claims render to, with sumA their
   * total. The sentence's letter vector is base (prefix + suffix) + conjunction + one
   * precomputed vector per claim, so changing one claim costs 26 additions.
   */
  function Solver(specOpts, seed) {
    var spec = makeSpec(specOpts);
    this.spec = spec;
    this.seed = seed == null ? ((Math.random() * 4294967296) >>> 0) : seed >>> 0;
    this.rand = mulberry32(this.seed);
    var fixedText = spec.prefix + ' ' + spec.suffix;
    this.base = countLetters(fixedText);
    this.conjVec = countLetters(spec.conj);
    this.conjLen = foldLetters(spec.conj).length;

    // claimable[i]: may claim i ever appear; floor[i]: the smallest value claim i may take.
    this.claimable = new Uint8Array(27);
    this.floor = new Int32Array(27);
    for (var i = 0; i < 26; i++) {
      var on = spec.list !== 'custom' || spec.custom.indexOf(ALPHABET[i]) >= 0;
      this.claimable[i] = on ? 1 : 0;
      this.floor[i] = (spec.list === 'auto' || !on) ? 0 : 1;
    }
    this.claimable[TOTAL] = spec.total ? 1 : 0;
    // A total of one could never be true ("one letter:" alone has nine), and keeping it at two
    // or more lets the solver treat the plural "letters:" as fixed text.
    this.floor[TOTAL] = spec.total ? 2 : 0;

    // The word "letters:" is fixed text once a total is claimed.
    if (spec.total) {
      var lv = countLetters('letters');
      for (var q = 0; q < 26; q++) this.base[q] += lv[q];
    }
    this.baseLen = 0;
    for (q = 0; q < 26; q++) this.baseLen += this.base[q];

    // itemVec[(i*(MAX_N+1)+n)*26 + c]: letters added by claim i at value n; itemLen: their sum.
    var stride = MAX_N + 1;
    this.stride = stride;
    this.itemVec = new Uint8Array(27 * stride * 26);
    this.itemLen = new Int32Array(27 * stride);
    var numVec = [];
    for (var n = 0; n <= MAX_N; n++) numVec.push(countLetters(numberWord(n, spec.hundredAnd)));
    for (i = 0; i < 27; i++) {
      if (!this.claimable[i]) continue;
      for (n = 1; n <= MAX_N; n++) {
        var off = (i * stride + n) * 26;
        var nv = numVec[n];
        var len = 0;
        for (var k = 0; k < 26; k++) { this.itemVec[off + k] = nv[k]; len += nv[k]; }
        if (i < 26) {
          this.itemVec[off + i] += 1; len += 1;                          // the letter itself
          if (n !== 1) { this.itemVec[off + 18] += 1; len += 1; }        // plural s
        }
        this.itemLen[i * stride + n] = len;
      }
    }

    // numberLetter[i]: letter i can come from number words or the conjunction, so a lone
    // "one q" style claim is only self-sufficient for letters outside this set.
    this.numberLetter = new Uint8Array(26);
    var nl = lettersInNumberWords(spec.hundredAnd) + foldLetters(spec.conj);
    for (i = 0; i < nl.length; i++) this.numberLetter[nl.charCodeAt(i) - A] = 1;
    this.bonusRate = spec.list === 'auto' && spec.bonus ? 0.02 : 0;
    this.strictAuto = spec.list === 'auto' && !spec.bonus;

    this.v = new Int32Array(27);
    this.a = new Int32Array(26);
    this.sumA = 0;
    this.listed = 0;
    this.best = new Int32Array(27);
    this.bestScore = Infinity;
    this.bestErrors = Infinity;
    this.bestDistance = Infinity;
    this.iterations = 0;
    this.restarts = 0;
    this.stale = 0;
    this.restartAfter = 5000;
    this.solved = false;
    this._wrong = new Int32Array(27);
    this.start();
  }

  /** Actual value that claim i is checked against. */
  Solver.prototype.actual = function (i) { return i === TOTAL ? this.sumA : this.a[i]; };

  Solver.prototype.recompute = function () {
    var a = this.a, v = this.v, stride = this.stride, k;
    for (k = 0; k < 26; k++) a[k] = this.base[k];
    var sum = this.baseLen, listed = 0;
    for (var i = 0; i < 27; i++) {
      if (!this.claimable[i] || v[i] <= 0) continue;
      if (i < 26) listed++;
      var off = (i * stride + v[i]) * 26;
      for (k = 0; k < 26; k++) a[k] += this.itemVec[off + k];
      sum += this.itemLen[i * stride + v[i]];
    }
    if (listed >= 2) { for (k = 0; k < 26; k++) a[k] += this.conjVec[k]; sum += this.conjLen; }
    this.listed = listed;
    this.sumA = sum;
  };

  Solver.prototype.clamp = function (i, n) {
    if (n < this.floor[i]) n = this.floor[i];
    if (n > MAX_N) n = MAX_N;
    return n;
  };

  /** Change one claim and update the actual counts incrementally. */
  Solver.prototype.setClaim = function (i, n) {
    var old = this.v[i];
    if (old === n) return;
    var stride = this.stride, a = this.a, k, off;
    var listedBefore = this.listed;
    if (old > 0) {
      off = (i * stride + old) * 26;
      for (k = 0; k < 26; k++) a[k] -= this.itemVec[off + k];
      this.sumA -= this.itemLen[i * stride + old];
      if (i < 26) this.listed--;
    }
    if (n > 0) {
      off = (i * stride + n) * 26;
      for (k = 0; k < 26; k++) a[k] += this.itemVec[off + k];
      this.sumA += this.itemLen[i * stride + n];
      if (i < 26) this.listed++;
    }
    var wasConj = listedBefore >= 2, isConj = this.listed >= 2;
    if (wasConj !== isConj) {
      var sgn = isConj ? 1 : -1;
      for (k = 0; k < 26; k++) a[k] += sgn * this.conjVec[k];
      this.sumA += sgn * this.conjLen;
    }
    this.v[i] = n;
  };

  /**
   * A lone claim is "one q" where that q is the only q in the sentence: true, but true only
   * because it mentions itself. Unless spec.bonus allows them, 'auto' mode treats lone
   * claims as faults to remove, so the list sticks to letters the sentence really uses.
   */
  Solver.prototype.isLone = function (i) {
    return this.strictAuto && i < 26 && this.v[i] === 1 && this.a[i] === 1;
  };

  Solver.prototype.isWrong = function (i) {
    return this.claimable[i] === 1 && (this.v[i] !== this.actual(i) || this.isLone(i));
  };

  /** Number of faulty claims (an empty list counts as one: it is vacuous, not true). */
  Solver.prototype.errors = function () {
    var e = 0;
    for (var i = 0; i < 27; i++) if (this.isWrong(i)) e++;
    if (this.listed === 0) e++;
    return e;
  };

  /** Sum of |claimed - actual|: a finer distance used to rank near misses. */
  Solver.prototype.distance = function () {
    var d = 0;
    for (var i = 0; i < 27; i++) if (this.claimable[i]) d += Math.abs(this.v[i] - this.actual(i));
    return d;
  };

  /** Seed the claims from the prefix and iterate the plain map a few times to get close. */
  Solver.prototype.start = function () {
    var v = this.v;
    for (var i = 0; i < 26; i++) {
      if (!this.claimable[i]) { v[i] = 0; continue; }
      v[i] = Math.max(this.floor[i], this.base[i] > 0 ? this.base[i] + 1 : 0);
    }
    v[TOTAL] = 0;
    this.recompute();
    for (var r = 0; r < 4; r++) {
      for (i = 0; i < 27; i++) if (this.claimable[i]) v[i] = this.clamp(i, this.actual(i));
      this.recompute();
    }
    this.noteBest();
  };

  Solver.prototype.noteBest = function () {
    var e = this.errors();
    var d = this.distance();
    var score = e * 100000 + d;
    if (score < this.bestScore) {
      this.bestScore = score;
      this.bestErrors = e;
      this.bestDistance = d;
      this.best.set(this.v);
      if (e === 0) this.solved = true;
      return true;
    }
    return false;
  };

  /**
   * Run up to `budget` sweeps; returns true once a true sentence has been found.
   *
   * One sweep visits every false claim in random order and moves it to a random value
   * between what it says now (exclusive) and what the sentence, as it stands at that
   * moment, really contains (inclusive). Plain "set every claim to the true count" iteration falls
   * into short cycles, because fixing the e's breaks the n's which breaks the e's; the random
   * partial step breaks those cycles. Updating claims one at a time against the live counts
   * measured about twice as effective as updating them all from one snapshot.
   */
  Solver.prototype.run = function (budget) {
    if (this.solved) return true;
    var rand = this.rand, v = this.v, wrong = this._wrong;
    for (var it = 0; it < budget; it++) {
      var nw = 0;
      for (var i = 0; i < 27; i++) if (this.isWrong(i)) wrong[nw++] = i;
      if (nw === 0 && this.listed === 0) wrong[nw++] = this.firstLetterClaim();
      this.iterations++;
      if (nw === 0) { this.noteBest(); return true; }
      for (var q = nw - 1; q > 0; q--) {
        var r = (rand() * (q + 1)) | 0;
        var tmp = wrong[q]; wrong[q] = wrong[r]; wrong[r] = tmp;
      }
      for (q = 0; q < nw; q++) {
        var j = wrong[q];
        var cur = v[j], tgt = this.isLone(j) ? 0 : this.actual(j);
        if (tgt === cur) { if (this.listed > 0) continue; tgt = cur + 1; }
        var lo = cur < tgt ? cur : tgt, hi = cur < tgt ? tgt : cur;
        var t = lo + ((rand() * (hi - lo)) | 0); // uniform over [lo, hi] minus the current value
        if (t >= cur) t++;
        this.setClaim(j, this.clamp(j, t));
      }
      if (this.bonusRate && rand() < this.bonusRate) this.toggleBonus();
      if (this.noteBest()) this.stale = 0;
      else if (++this.stale > this.restartAfter) this.restart();
    }
    return this.solved;
  };

  /**
   * A walk that has gone a long time without beating its best is usually circling one trap.
   * Jump to a random point near the best state found so far and walk again. (Large searches
   * barely need this; small ones, like a five-vowel inventory, depend on it.)
   */
  Solver.prototype.restart = function () {
    this.restarts++;
    this.stale = 0;
    for (var i = 0; i < 27; i++) {
      if (!this.claimable[i] || (this.strictAuto && this.best[i] === 0)) continue;
      var spread = 1 + ((this.rand() * 6) | 0);
      this.v[i] = this.clamp(i, this.best[i] + ((this.rand() * (2 * spread + 1)) | 0) - spread);
    }
    this.recompute();
  };

  /** The caller already has this solution: forget it and keep searching somewhere else. */
  Solver.prototype.reject = function () {
    this.solved = false;
    this.bestScore = Infinity;
    this.bestErrors = Infinity;
    this.bestDistance = Infinity;
    this.restart();
    this.noteBest();
  };

  Solver.prototype.firstLetterClaim = function () {
    for (var i = 0; i < 26; i++) if (this.claimable[i]) return i;
    return 0;
  };

  /**
   * 'auto' mode with bonus on: flip a self-sufficient "one q" claim on or off. A letter that
   * occurs nowhere else can be listed as "one q" (then true) or left out (also true), so the
   * flip moves between equally honest sentence shapes and gives a stuck search new ground.
   */
  Solver.prototype.toggleBonus = function () {
    var v = this.v, a = this.a;
    var start = (this.rand() * 26) | 0;
    for (var k = 0; k < 26; k++) {
      var i = (start + k) % 26;
      if (!this.claimable[i] || this.floor[i] > 0 || this.numberLetter[i]) continue;
      if (v[i] === 0 && a[i] === 0) { this.setClaim(i, 1); return true; }
      if (v[i] === 1 && a[i] === 1 && this.base[i] === 0) { this.setClaim(i, 0); return true; }
    }
    return false;
  };

  Solver.prototype.claims = function (which) {
    var src = which === 'best' ? this.best : this.v;
    return { counts: Array.prototype.slice.call(src, 0, 26), total: src[TOTAL] };
  };

  Solver.prototype.sentence = function (which) {
    var c = this.claims(which);
    return render(this.spec, c.counts, c.total);
  };

  var api = {
    ALPHABET: ALPHABET,
    MAX_N: MAX_N,
    DEFAULTS: DEFAULTS,
    numberWord: numberWord,
    parseNumberWord: parseNumberWord,
    foldLetters: foldLetters,
    countLetters: countLetters,
    lettersInNumberWords: lettersInNumberWords,
    makeSpec: makeSpec,
    listedLetters: listedLetters,
    renderSegments: renderSegments,
    render: render,
    check: check,
    verify: verify,
    loneLetters: loneLetters,
    Solver: Solver,
    mulberry32: mulberry32
  };
  root.Autogram = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
