// Endpapers — a tiny engine for a passage graph with state.
// Pure: no DOM, no globals touched. Loads as a classic <script> (defines
// `EndpapersEngine`) and as a CommonJS module (module.exports) for tests.
//
// Story format (see story.js):
//   { title, start, vars: {name: default}, list: [entry], provenance: [line],
//     passages: { id: { head?, set?, text: [block], choices: [choice], ending? } } }
//   block  := "paragraph" | {quote} | {hand} | {list: true} | {if, text|then, else}
//   choice := { text, to, if?, set? }     to := id | [{if?, id}]
//   entry  := { if?, by, line }           line := { if?, text }
// Conditions are strings in a tiny language:
//   name            true when the variable is boolean true
//   name=value      string comparison; name!=value
//   a and b, a or b, not a, ( ... )

var EndpapersEngine = (function () {
  'use strict';

  // ---------- conditions ----------
  function tokenize(src) {
    var out = [];
    var re = /\s*(\(|\)|!=|=|[A-Za-z0-9_][A-Za-z0-9_\-']*)\s*/y;
    var m;
    var last = 0;
    while (last < src.length) {
      re.lastIndex = last;
      m = re.exec(src);
      if (!m || m[0].length === 0) throw new Error('bad condition near "' + src.slice(last) + '"');
      out.push(m[1]);
      last = re.lastIndex;
    }
    return out;
  }

  // Parses to a small AST so the same tree serves evaluation and static analysis.
  function parseCond(src) {
    if (typeof src !== 'string' || !src.trim()) throw new Error('empty condition');
    var toks = tokenize(src);
    var i = 0;
    function peek() { return toks[i]; }
    function next() { return toks[i++]; }
    function parseOr() {
      var node = parseAnd();
      while (peek() === 'or') { next(); node = { op: 'or', a: node, b: parseAnd() }; }
      return node;
    }
    function parseAnd() {
      var node = parseNot();
      while (peek() === 'and') { next(); node = { op: 'and', a: node, b: parseNot() }; }
      return node;
    }
    function parseNot() {
      if (peek() === 'not') { next(); return { op: 'not', a: parseNot() }; }
      return parseAtom();
    }
    function parseAtom() {
      var t = next();
      if (t === '(') {
        var inner = parseOr();
        if (next() !== ')') throw new Error('missing ) in "' + src + '"');
        return inner;
      }
      if (t === undefined || t === ')' || t === '=' || t === '!=' || t === 'and' || t === 'or' || t === 'not') {
        throw new Error('unexpected "' + t + '" in "' + src + '"');
      }
      if (peek() === '=' || peek() === '!=') {
        var op = next();
        var v = next();
        if (v === undefined) throw new Error('missing value in "' + src + '"');
        return { op: op === '=' ? 'eq' : 'ne', name: t, value: v };
      }
      return { op: 'truthy', name: t };
    }
    var ast = parseOr();
    if (i !== toks.length) throw new Error('trailing tokens in "' + src + '"');
    return ast;
  }

  var condCache = Object.create(null);
  function cond(src) {
    return condCache[src] || (condCache[src] = parseCond(src));
  }

  function evalAst(n, state) {
    switch (n.op) {
      case 'or': return evalAst(n.a, state) || evalAst(n.b, state);
      case 'and': return evalAst(n.a, state) && evalAst(n.b, state);
      case 'not': return !evalAst(n.a, state);
      case 'eq': return String(state[n.name]) === n.value;
      case 'ne': return String(state[n.name]) !== n.value;
      case 'truthy': return state[n.name] === true;
    }
    throw new Error('bad node');
  }

  function test(src, state) {
    if (src === undefined || src === null) return true;
    return evalAst(cond(src), state);
  }

  function condVars(src) {
    var names = [];
    (function walk(n) {
      if (n.name) names.push(n.name);
      if (n.a) walk(n.a);
      if (n.b) walk(n.b);
    })(cond(src));
    return names;
  }

  // ---------- rendering ----------
  // Turns a passage's blocks into flat, state-resolved blocks:
  //   {type:'p'|'quote'|'hand', text} | {type:'list', entries:[{by, text}]}
  function listEntries(story, state) {
    var out = [];
    (story.list || []).forEach(function (e) {
      if (!test(e.if, state)) return;
      var text = typeof e.line === 'string' ? e.line : resolveText(e.line, state);
      out.push({ by: e.by || 'ron', text: text });
    });
    return out;
  }

  // A "text" value is a string, or an array of strings/{if,text,else} to join.
  function resolveText(parts, state) {
    if (typeof parts === 'string') return parts;
    return parts.map(function (p) {
      if (typeof p === 'string') return p;
      if (test(p.if, state)) return resolveText(p.text, state);
      return p.else === undefined ? '' : resolveText(p.else, state);
    }).join('').replace(/\s+([,.;:])/g, '$1').replace(/ {2,}/g, ' ').trim();
  }

  function flatten(blocks, state, story, out) {
    blocks.forEach(function (b) {
      if (typeof b === 'string') { out.push({ type: 'p', text: b }); return; }
      if (Array.isArray(b)) { out.push({ type: 'p', text: resolveText(b, state) }); return; }
      if (b.list) { out.push({ type: 'list', entries: listEntries(story, state) }); return; }
      if (b.quote !== undefined) { out.push({ type: 'quote', text: resolveText(b.quote, state) }); return; }
      if (b.hand !== undefined) { out.push({ type: 'hand', text: resolveText(b.hand, state) }); return; }
      if (b.if !== undefined) {
        var branch = test(b.if, state) ? b.then : b.else;
        if (branch === undefined) return;
        flatten(Array.isArray(branch) ? branch : [branch], state, story, out);
        return;
      }
      throw new Error('unknown block ' + JSON.stringify(b));
    });
    return out;
  }

  function renderBlocks(story, passage, state) {
    return flatten(passage.text || [], state, story, []);
  }

  function resolveTarget(to, state) {
    if (typeof to === 'string') return to;
    for (var i = 0; i < to.length; i++) if (test(to[i].if, state)) return to[i].id;
    return null;
  }

  function visibleChoices(story, passage, state) {
    var out = [];
    (passage.choices || []).forEach(function (c, i) {
      if (!test(c.if, state)) return;
      out.push({ index: i, text: resolveText(c.text, state), to: resolveTarget(c.to, state), set: c.set || null, hand: !!c.hand });
    });
    return out;
  }

  function applySet(state, set) {
    if (!set) return;
    Object.keys(set).forEach(function (k) { state[k] = set[k]; });
  }

  function provenance(story, state) {
    var entries = listEntries(story, state);
    var counts = {};
    entries.forEach(function (e) { counts[e.by] = (counts[e.by] || 0) + 1; });
    var out = [];
    (story.provenance || []).forEach(function (line) {
      if (!test(line.if, state)) return;
      var text = resolveText(line.text, state).replace(/\{(\w+)_lines\}/g, function (_, by) { return String(counts[by] || 0); });
      if (text) out.push(text);
    });
    return out;
  }

  // ---------- the game ----------
  function createGame(story) {
    var state, at, trail, choicesTaken;
    function reset() {
      state = {};
      Object.keys(story.vars).forEach(function (k) { state[k] = story.vars[k]; });
      at = story.start;
      trail = [at];
      choicesTaken = [];
      applySet(state, story.passages[at].set);
    }
    reset();
    return {
      start: reset,
      get state() { return state; },
      get at() { return at; },
      get trail() { return trail.slice(); },
      get taken() { return choicesTaken.slice(); },
      passage: function () { return story.passages[at]; },
      blocks: function () { return renderBlocks(story, story.passages[at], state); },
      choices: function () { return visibleChoices(story, story.passages[at], state); },
      isEnding: function () { return !!story.passages[at].ending; },
      provenance: function () { return provenance(story, state); },
      // Choose by position in the *visible* list.
      choose: function (n) {
        var cs = visibleChoices(story, story.passages[at], state);
        var c = cs[n];
        if (!c) throw new Error('no choice ' + n + ' at ' + at);
        if (!c.to || !story.passages[c.to]) throw new Error('choice leads nowhere: ' + at + ' -> ' + c.to);
        applySet(state, c.set);
        at = c.to;
        trail.push(at);
        choicesTaken.push(c.text);
        applySet(state, story.passages[at].set);
        return at;
      },
    };
  }

  // ---------- static analysis / traversal ----------
  function wordsIn(s) {
    var m = String(s).replace(/[*_]/g, '').match(/[A-Za-z0-9'’\-]+/g);
    return m ? m.length : 0;
  }

  function textWords(parts) {
    if (typeof parts === 'string') return wordsIn(parts);
    var n = 0;
    parts.forEach(function (p) {
      if (typeof p === 'string') n += wordsIn(p);
      else { n += textWords(p.text); if (p.else !== undefined) n += textWords(p.else); }
    });
    return n;
  }

  function blockWords(blocks) {
    var n = 0;
    blocks.forEach(function (b) {
      if (typeof b === 'string') n += wordsIn(b);
      else if (Array.isArray(b)) n += textWords(b);
      else if (b.quote !== undefined) n += textWords(b.quote);
      else if (b.hand !== undefined) n += textWords(b.hand);
      else if (b.if !== undefined) {
        if (b.then !== undefined) n += blockWords(Array.isArray(b.then) ? b.then : [b.then]);
        if (b.else !== undefined) n += blockWords(Array.isArray(b.else) ? b.else : [b.else]);
      }
    });
    return n;
  }

  function renderedWords(blocks) {
    var n = 0;
    blocks.forEach(function (b) {
      if (b.type === 'list') b.entries.forEach(function (e) { n += wordsIn(e.text); });
      else n += wordsIn(b.text);
    });
    return n;
  }

  // Collect every condition string and every variable read/written, statically.
  function collectConds(story) {
    var conds = [];
    var writes = {};
    Object.keys(story.vars).forEach(function (k) { writes[k] = true; });
    function fromText(parts) {
      if (typeof parts === 'string') return;
      parts.forEach(function (p) {
        if (typeof p === 'string') return;
        if (p.if !== undefined) conds.push(p.if);
        fromText(p.text);
        if (p.else !== undefined) fromText(p.else);
      });
    }
    function fromBlocks(blocks) {
      blocks.forEach(function (b) {
        if (typeof b === 'string') return;
        if (Array.isArray(b)) { fromText(b); return; }
        if (b.quote !== undefined) fromText(b.quote);
        if (b.hand !== undefined) fromText(b.hand);
        if (b.if !== undefined) {
          conds.push(b.if);
          if (b.then !== undefined) fromBlocks(Array.isArray(b.then) ? b.then : [b.then]);
          if (b.else !== undefined) fromBlocks(Array.isArray(b.else) ? b.else : [b.else]);
        }
      });
    }
    Object.keys(story.passages).forEach(function (id) {
      var p = story.passages[id];
      if (p.set) Object.keys(p.set).forEach(function (k) { writes[k] = true; });
      fromBlocks(p.text || []);
      (p.choices || []).forEach(function (c) {
        if (c.if !== undefined) conds.push(c.if);
        fromText(c.text);
        if (c.set) Object.keys(c.set).forEach(function (k) { writes[k] = true; });
        if (Array.isArray(c.to)) c.to.forEach(function (t) { if (t.if !== undefined) conds.push(t.if); });
      });
    });
    (story.list || []).forEach(function (e) { if (e.if !== undefined) conds.push(e.if); fromText(e.line); });
    (story.provenance || []).forEach(function (l) { if (l.if !== undefined) conds.push(l.if); fromText(l.text); });
    var reads = {};
    conds.forEach(function (c) { condVars(c).forEach(function (v) { reads[v] = true; }); });
    return { conds: conds, reads: Object.keys(reads).sort(), writes: Object.keys(writes).sort() };
  }

  // Walks every (passage, state) pair reachable from the start through the
  // real choice logic. Counts distinct complete paths (choice sequences).
  function traverse(story) {
    var reachable = {};
    var endings = {};
    var deadEnds = {};
    var missing = {};
    var cycles = [];
    var memo = {};
    var onStack = {};
    var statesSeen = 0;
    var minWords = Infinity, maxWords = 0, minChoices = Infinity, maxChoices = 0;
    var pathsTo = {}; // ending id -> number of paths that end there

    function key(id, state) { return id + '|' + JSON.stringify(state); }

    // Returns {paths, min, max} for complete paths from (id, state): words along the path.
    function visit(id, state, wordsSoFar, choicesSoFar) {
      var k = key(id, state);
      if (onStack[k]) { cycles.push(id); return { paths: 0 }; }
      reachable[id] = true;
      var p = story.passages[id];
      var blocks = renderBlocks(story, p, state);
      var here = wordsSoFar + renderedWords(blocks);
      if (p.ending) {
        endings[id] = true;
        pathsTo[id] = (pathsTo[id] || 0) + 1;
        if (here < minWords) minWords = here;
        if (here > maxWords) maxWords = here;
        if (choicesSoFar < minChoices) minChoices = choicesSoFar;
        if (choicesSoFar > maxChoices) maxChoices = choicesSoFar;
        return { paths: 1 };
      }
      if (memo[k] !== undefined) {
        // Already counted from here; still need min/max words, which depend on the
        // prefix. Cheap re-walk without counting again.
        rewalk(id, state, here, choicesSoFar);
        return { paths: memo[k] };
      }
      onStack[k] = true;
      statesSeen++;
      var cs = visibleChoices(story, p, state);
      if (!cs.length) deadEnds[id] = true;
      var total = 0;
      cs.forEach(function (c) {
        if (!c.to || !story.passages[c.to]) { missing[id + ' -> ' + c.to] = true; return; }
        var s2 = {};
        Object.keys(state).forEach(function (x) { s2[x] = state[x]; });
        applySet(s2, c.set);
        applySet(s2, story.passages[c.to].set);
        total += visit(c.to, s2, here + wordsIn(c.text), choicesSoFar + 1).paths;
      });
      delete onStack[k];
      memo[k] = total;
      return { paths: total };
    }

    // Walks the subtree again only to update min/max word counts of complete paths.
    function rewalk(id, state, here, choicesSoFar) {
      var p = story.passages[id];
      if (p.ending) {
        if (here < minWords) minWords = here;
        if (here > maxWords) maxWords = here;
        if (choicesSoFar < minChoices) minChoices = choicesSoFar;
        if (choicesSoFar > maxChoices) maxChoices = choicesSoFar;
        return;
      }
      visibleChoices(story, p, state).forEach(function (c) {
        if (!c.to || !story.passages[c.to]) return;
        var s2 = {};
        Object.keys(state).forEach(function (x) { s2[x] = state[x]; });
        applySet(s2, c.set);
        applySet(s2, story.passages[c.to].set);
        var t = story.passages[c.to];
        rewalk(c.to, s2, here + wordsIn(c.text) + renderedWords(renderBlocks(story, t, s2)), choicesSoFar + 1);
      });
    }

    var state0 = {};
    Object.keys(story.vars).forEach(function (k) { state0[k] = story.vars[k]; });
    applySet(state0, story.passages[story.start].set);
    var r = visit(story.start, state0, 0, 0);

    var allIds = Object.keys(story.passages);
    var staticWords = 0;
    allIds.forEach(function (id) {
      var p = story.passages[id];
      staticWords += blockWords(p.text || []);
      (p.choices || []).forEach(function (c) { staticWords += textWords(c.text); });
    });
    (story.list || []).forEach(function (e) { staticWords += textWords(e.line); });

    var stat = collectConds(story);
    return {
      passages: allIds.length,
      reachable: Object.keys(reachable).sort(),
      unreachable: allIds.filter(function (id) { return !reachable[id]; }),
      endingsDefined: allIds.filter(function (id) { return story.passages[id].ending; }).sort(),
      endingsReached: Object.keys(endings).sort(),
      deadEnds: Object.keys(deadEnds).sort(),
      missing: Object.keys(missing).sort(),
      cycles: cycles,
      paths: r.paths,
      pathsPerEnding: pathsTo,
      statesSeen: statesSeen,
      words: staticWords,
      pathWords: { min: minWords, max: maxWords },
      pathChoices: { min: minChoices, max: maxChoices },
      reads: stat.reads,
      writes: stat.writes,
      conds: stat.conds,
    };
  }

  return {
    parseCond: parseCond,
    test: test,
    condVars: condVars,
    resolveText: resolveText,
    renderBlocks: renderBlocks,
    listEntries: listEntries,
    visibleChoices: visibleChoices,
    resolveTarget: resolveTarget,
    provenance: provenance,
    createGame: createGame,
    traverse: traverse,
    wordsIn: wordsIn,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EndpapersEngine;
