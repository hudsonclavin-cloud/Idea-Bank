// pdfupdate.js — reorder the pages of a PDF, and add blank ones, without rewriting it.
//
// Pure logic, no DOM, no dependencies (it even brings its own inflate). Loads as a classic
// <script> (defines window.QuirePDF) and as a CommonJS module (module.exports).
//
// How. A PDF's pages are leaves of a tree whose root is the catalog's /Pages object; the order
// of the leaves is the order of the pages. PDF allows a file to be changed by *appending* an
// "incremental update": new copies of the objects you want to change, a new cross-reference
// section that points at them, and a trailer whose /Prev points back at the old one. Readers
// start from the end of the file, so the new copies win. So to reorder a book we append:
//   - a new /Pages root with /Kids in the new order and the new /Count,
//   - a new copy of any page whose /Parent was not the root (flattening the tree), with any
//     attributes it used to inherit from in-between nodes (MediaBox, CropBox, Rotate, Resources)
//     written into it, so nothing is lost by re-parenting,
//   - a blank page object for every blank the booklet needs, the size of the first page,
//   - a cross-reference table (or stream, if the file used streams) and trailer.
// Every original byte stays where it was. The update is usually a few kilobytes.
//
// Finding objects. Instead of trusting the cross-reference data (which is wrong in a surprising
// number of real files), we scan the whole file for "N G obj" and take the last definition of
// each object number, which is exactly what readers do when they repair a file. Objects packed
// inside compressed object streams (/Type /ObjStm) are unpacked and scanned the same way.
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.QuirePDF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- bytes <-> latin1 text (one char per byte, exactly) ----------

  function bytesToLatin1(bytes) {
    let s = '';
    const CH = 32768;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
    return s;
  }

  function latin1ToBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  // ---------- a small PDF tokenizer / object parser ----------

  const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
  const DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);
  const isWs = (c) => WS.has(c.charCodeAt(0));
  const isRegular = (c) => !isWs(c) && !DELIM.has(c);

  class Name {
    constructor(raw) {
      this.raw = raw; // including the leading slash, with #xx escapes as written
      this.v = raw.slice(1).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    }
  }
  class Ref {
    constructor(num, gen) {
      this.num = num;
      this.gen = gen;
    }
  }
  class Str {
    constructor(raw) {
      this.raw = raw; // "(...)" or "<...>" exactly as in the file
    }
  }
  class Dict {
    constructor() {
      this.map = new Map(); // key (decoded name) -> value; `names` keeps the raw spelling
      this.names = new Map();
    }
    get(k) {
      return this.map.get(k);
    }
    has(k) {
      return this.map.has(k);
    }
    set(k, v, raw) {
      this.map.set(k, v);
      if (raw) this.names.set(k, raw);
      else if (!this.names.has(k)) this.names.set(k, '/' + k);
    }
    delete(k) {
      this.map.delete(k);
    }
    clone() {
      const d = new Dict();
      for (const [k, v] of this.map) d.set(k, v, this.names.get(k));
      return d;
    }
  }
  class Stream {
    constructor(dict, dataStart, dataEnd) {
      this.dict = dict;
      this.dataStart = dataStart;
      this.dataEnd = dataEnd;
    }
  }
  const Keyword = (v) => ({ keyword: v });

  class Parser {
    constructor(text) {
      this.t = text;
      this.p = 0;
    }
    skipWs() {
      const t = this.t;
      while (this.p < t.length) {
        const c = t[this.p];
        if (isWs(c)) this.p++;
        else if (c === '%') {
          while (this.p < t.length && t[this.p] !== '\n' && t[this.p] !== '\r') this.p++;
        } else break;
      }
    }
    // Returns one token: a value (number, Name, Str, boolean, null), or {keyword}, or a
    // punctuation string among '[', ']', '<<', '>>', '{', '}'.
    token() {
      this.skipWs();
      const t = this.t;
      if (this.p >= t.length) return undefined;
      const c = t[this.p];
      if (c === '/') {
        let q = this.p + 1;
        while (q < t.length && isRegular(t[q])) q++;
        const raw = t.slice(this.p, q);
        this.p = q;
        return new Name(raw);
      }
      if (c === '(') {
        let depth = 0;
        let q = this.p;
        for (; q < t.length; q++) {
          const ch = t[q];
          if (ch === '\\') q++;
          else if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0) {
              q++;
              break;
            }
          }
        }
        const raw = t.slice(this.p, q);
        this.p = q;
        return new Str(raw);
      }
      if (c === '<') {
        if (t[this.p + 1] === '<') {
          this.p += 2;
          return '<<';
        }
        const q = t.indexOf('>', this.p);
        if (q < 0) throw new Error('unterminated hex string');
        const raw = t.slice(this.p, q + 1);
        this.p = q + 1;
        return new Str(raw);
      }
      if (c === '>') {
        if (t[this.p + 1] === '>') {
          this.p += 2;
          return '>>';
        }
        throw new Error('stray >');
      }
      if (c === '[' || c === ']' || c === '{' || c === '}') {
        this.p++;
        return c;
      }
      if (c === ')') throw new Error('stray )');
      // number or keyword
      let q = this.p;
      while (q < t.length && isRegular(t[q])) q++;
      const word = t.slice(this.p, q);
      this.p = q;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'null') return null;
      if (word === '') throw new Error('unexpected character ' + JSON.stringify(c));
      return Keyword(word);
    }
    // Parses one object starting at the current position. Indirect references "n g R" are
    // folded into Ref values here.
    object() {
      const tok = this.token();
      return this.fromToken(tok);
    }
    fromToken(tok) {
      if (tok === undefined) throw new Error('unexpected end of data');
      if (tok === '[') {
        const arr = [];
        for (;;) {
          const t2 = this.token();
          if (t2 === ']') return arr;
          if (t2 === undefined) throw new Error('unterminated array');
          arr.push(this.fromToken(t2));
        }
      }
      if (tok === '<<') {
        const d = new Dict();
        for (;;) {
          const k = this.token();
          if (k === '>>') return d;
          if (k === undefined) throw new Error('unterminated dictionary');
          if (!(k instanceof Name)) {
            // tolerate junk: skip a value
            continue;
          }
          const v = this.object();
          d.set(k.v, v, k.raw);
        }
      }
      if (typeof tok === 'number' && Number.isInteger(tok) && tok >= 0) {
        // maybe "n g R"
        const save = this.p;
        const t2 = this.token();
        if (typeof t2 === 'number' && Number.isInteger(t2) && t2 >= 0) {
          const t3 = this.token();
          if (t3 && t3.keyword === 'R') return new Ref(tok, t2);
          this.p = save; // not a reference: re-read the second number as the next token
          return tok;
        }
        this.p = save;
        return tok;
      }
      if (tok === ']' || tok === '>>' || tok === '{' || tok === '}') throw new Error('unexpected ' + tok);
      return tok; // number, Name, Str, boolean, null, {keyword}
    }
  }

  // ---------- serializer ----------

  function fmtNum(n) {
    if (Number.isInteger(n)) return String(n);
    let s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  function serialize(v) {
    if (v === null) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return fmtNum(v);
    if (v instanceof Name) return v.raw;
    if (v instanceof Str) return v.raw;
    if (v instanceof Ref) return `${v.num} ${v.gen} R`;
    if (Array.isArray(v)) return '[' + v.map(serialize).join(' ') + ']';
    if (v instanceof Dict) {
      let s = '<<';
      for (const [k, val] of v.map) s += ' ' + v.names.get(k) + ' ' + serialize(val);
      return s + ' >>';
    }
    if (v instanceof Stream) throw new Error('cannot serialize a stream');
    throw new Error('cannot serialize ' + String(v));
  }

  function containsString(v) {
    if (v instanceof Str) return true;
    if (Array.isArray(v)) return v.some(containsString);
    if (v instanceof Dict) {
      for (const val of v.map.values()) if (containsString(val)) return true;
    }
    return false;
  }

  // ---------- inflate (RFC 1950/1951), written here so nothing depends on the host ----------
  //
  // Object streams are almost always FlateDecode. A dependency-free inflater is ~120 lines and,
  // unlike the browser's DecompressionStream, is synchronous and does not care about junk
  // after the final block (which some producers leave in the stream).

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  // Canonical Huffman table from a list of code lengths (as in zlib's puff.c).
  function huffman(lengths) {
    const count = new Uint16Array(16);
    for (const l of lengths) count[l]++;
    count[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    const symbol = new Uint16Array(lengths.length);
    lengths.forEach((l, s) => {
      if (l) symbol[offs[l]++] = s;
    });
    return { count, symbol };
  }

  function inflateRaw(src, start) {
    let pos = start;
    let bitBuf = 0;
    let bitCnt = 0;
    let out = new Uint8Array(Math.max(1024, src.length * 4));
    let o = 0;
    const need = (n) => {
      if (o + n > out.length) {
        let len = out.length * 2;
        while (len < o + n) len *= 2;
        const bigger = new Uint8Array(len);
        bigger.set(out.subarray(0, o));
        out = bigger;
      }
    };
    const bits = (n) => {
      while (bitCnt < n) {
        if (pos >= src.length) throw new Error('unexpected end of deflate data');
        bitBuf |= src[pos++] << bitCnt;
        bitCnt += 8;
      }
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    };
    const decode = (h) => {
      let code = 0;
      let first = 0;
      let index = 0;
      for (let len = 1; len < 16; len++) {
        code |= bits(1);
        const c = h.count[len];
        if (code - first < c) return h.symbol[index + (code - first)];
        index += c;
        first += c;
        first <<= 1;
        code <<= 1;
      }
      throw new Error('bad Huffman code');
    };
    let fixedLit = null;
    let fixedDist = null;
    for (;;) {
      const last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        if (pos + 4 > src.length) throw new Error('truncated stored block');
        const len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('truncated stored block');
        need(len);
        out.set(src.subarray(pos, pos + len), o);
        o += len;
        pos += len;
      } else if (type === 1 || type === 2) {
        let lit;
        let dist;
        if (type === 1) {
          if (!fixedLit) {
            const l = new Array(288);
            for (let i = 0; i < 144; i++) l[i] = 8;
            for (let i = 144; i < 256; i++) l[i] = 9;
            for (let i = 256; i < 280; i++) l[i] = 7;
            for (let i = 280; i < 288; i++) l[i] = 8;
            fixedLit = huffman(l);
            fixedDist = huffman(new Array(30).fill(5));
          }
          lit = fixedLit;
          dist = fixedDist;
        } else {
          const hlit = bits(5) + 257;
          const hdist = bits(5) + 1;
          const hclen = bits(4) + 4;
          const cl = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
          const clh = huffman(cl);
          const lengths = [];
          while (lengths.length < hlit + hdist) {
            const sym = decode(clh);
            if (sym < 16) lengths.push(sym);
            else if (sym === 16) {
              if (!lengths.length) throw new Error('bad code lengths');
              const prev = lengths[lengths.length - 1];
              for (let r = 3 + bits(2); r > 0; r--) lengths.push(prev);
            } else if (sym === 17) for (let r = 3 + bits(3); r > 0; r--) lengths.push(0);
            else for (let r = 11 + bits(7); r > 0; r--) lengths.push(0);
          }
          lit = huffman(lengths.slice(0, hlit));
          dist = huffman(lengths.slice(hlit, hlit + hdist));
        }
        for (;;) {
          const sym = decode(lit);
          if (sym < 256) {
            need(1);
            out[o++] = sym;
          } else if (sym === 256) break;
          else {
            const li = sym - 257;
            if (li >= 29) throw new Error('bad length code');
            const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
            const di = decode(dist);
            if (di >= 30) throw new Error('bad distance code');
            const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
            if (d > o) throw new Error('distance too far back');
            need(len);
            for (let k = 0; k < len; k++) out[o + k] = out[o + k - d];
            o += len;
          }
        }
      } else throw new Error('bad block type');
      if (last) break;
    }
    return out.subarray(0, o);
  }

  // FlateDecode data: a zlib wrapper around deflate. Tolerates raw deflate and trailing junk.
  function inflate(data) {
    if (data.length >= 2 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0) {
      if (data[1] & 0x20) throw new Error('deflate stream needs a preset dictionary');
      return inflateRaw(data, 2);
    }
    return inflateRaw(data, 0);
  }

  // Undo a PNG predictor (DecodeParms /Predictor >= 10) on a decoded buffer.
  function unpredict(data, columns, colors, bpc) {
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((columns * colors * bpc) / 8);
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const ft = data[r * (rowLen + 1)];
      const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const row = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let x = src[i];
        switch (ft) {
          case 1:
            x += a;
            break;
          case 2:
            x += b;
            break;
          case 3:
            x += (a + b) >> 1;
            break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            break;
          }
          default:
            break;
        }
        row[i] = x & 0xff;
      }
      prev = row;
    }
    return out;
  }

  // ---------- the document model ----------

  const ENCRYPTED_STRUCTURE =
    'This PDF is encrypted (even if it opens without asking for a password) and its page list sits inside encrypted data, which Quire does not decrypt. Open it and print it to a new PDF, then use that.';

  class Doc {
    constructor(bytes) {
      this.bytes = bytes;
      this.text = bytesToLatin1(bytes);
      this.objs = new Map(); // num -> { num, gen, pos, value }
      this.trailer = new Dict(); // merged: later trailers override earlier ones, key by key
      this.trailerDicts = []; // [{ pos, dict }]
      this.trailerPos = -1;
      this.prev = null; // offset of the last cross-reference section
      this.xrefStyle = 'table';
      this.maxNum = 0;
      this.warnings = [];
    }

    define(num, gen, pos, value) {
      const cur = this.objs.get(num);
      if (!cur || pos >= cur.pos) this.objs.set(num, { num, gen, pos, value });
      if (num > this.maxNum) this.maxNum = num;
    }

    resolve(v, depth = 0) {
      let guard = 0;
      while (v instanceof Ref && guard++ < 32) {
        const o = this.objs.get(v.num);
        v = o ? o.value : null;
      }
      return v;
    }

    // Parse an indirect object whose "N G obj" header starts at `pos`. Returns the end offset.
    parseIndirect(pos, num, gen) {
      const t = this.text;
      const parser = new Parser(t);
      parser.p = pos;
      parser.token(); // num
      parser.token(); // gen
      parser.token(); // obj
      let value = parser.object();
      if (value && value.keyword === 'endobj') value = null;
      parser.skipWs();
      let end = parser.p;
      if (value instanceof Dict && t.startsWith('stream', parser.p)) {
        let q = parser.p + 6;
        if (t[q] === '\r') q++;
        if (t[q] === '\n') q++;
        const dataStart = q;
        let len = value.get('Length');
        if (len instanceof Ref) {
          const o = this.objs.get(len.num); // only works if it was defined earlier in the file
          len = o && typeof o.value === 'number' ? o.value : undefined;
        }
        let dataEnd;
        if (typeof len === 'number' && len >= 0 && dataStart + len <= t.length) {
          dataEnd = dataStart + len;
          const tail = t.slice(dataEnd, dataEnd + 12);
          if (!/^\s*endstream/.test(tail)) dataEnd = undefined; // /Length is wrong
        }
        if (dataEnd === undefined) {
          const e = t.indexOf('endstream', dataStart);
          if (e < 0) throw new Error('unterminated stream');
          dataEnd = e;
          while (dataEnd > dataStart && (t[dataEnd - 1] === '\n' || t[dataEnd - 1] === '\r')) dataEnd--;
        }
        value = new Stream(value, dataStart, dataEnd);
        end = t.indexOf('endstream', dataEnd);
        end = end < 0 ? dataEnd : end + 9;
      }
      this.define(num, gen, pos, value);
      return end;
    }

    scan() {
      const t = this.text;
      const re = /(\d+)[ \t\r\n\f\0]+(\d+)[ \t\r\n\f\0]+obj\b/g;
      let m;
      let cursor = 0;
      while ((m = re.exec(t))) {
        if (m.index < cursor) continue;
        if (m.index > 0 && isRegular(t[m.index - 1])) continue;
        try {
          cursor = this.parseIndirect(m.index, Number(m[1]), Number(m[2]));
          re.lastIndex = Math.max(re.lastIndex, cursor);
        } catch (e) {
          /* not a real object; keep scanning */
        }
      }
      // Trailers: classic "trailer << ... >>" dictionaries and /Type /XRef stream dictionaries.
      const tre = /trailer[ \t\r\n\f\0]*<</g;
      while ((m = tre.exec(t))) {
        try {
          const p = new Parser(t);
          p.p = m.index + 7;
          const d = p.object();
          if (d instanceof Dict) this.trailerDicts.push({ pos: m.index, dict: d });
        } catch (e) {
          /* ignore */
        }
      }
      for (const o of this.objs.values()) {
        if (o.value instanceof Stream && o.value.dict.get('Type') instanceof Name && o.value.dict.get('Type').v === 'XRef') {
          this.trailerDicts.push({ pos: o.pos, dict: o.value.dict });
        }
      }
      // Linearized files keep /Root in one trailer and /Size in another, so merge them all,
      // later ones winning key by key.
      this.trailerDicts.sort((a, b) => a.pos - b.pos);
      for (const { pos, dict } of this.trailerDicts) {
        for (const k of ['Root', 'Info', 'ID', 'Encrypt', 'Size']) if (dict.has(k)) this.trailer.set(k, dict.get(k), dict.names.get(k));
        this.trailerPos = pos;
      }
      const sre = /startxref[ \t\r\n\f\0]+(\d+)/g;
      let last = null;
      while ((m = sre.exec(t))) last = Number(m[1]);
      this.prev = last;
      if (last !== null && last < t.length) {
        const p = new Parser(t);
        p.p = last;
        p.skipWs();
        this.xrefStyle = t.startsWith('xref', p.p) ? 'table' : 'stream';
      } else {
        this.xrefStyle = this.trailerPos >= 0 && t.startsWith('trailer', this.trailerPos) ? 'table' : 'stream';
        if (last === null) this.warnings.push('The file has no startxref pointer; readers will have to rebuild its index (most do).');
      }
    }

    unpackObjectStreams() {
      const streams = [...this.objs.values()].filter((o) => o.value instanceof Stream && o.value.dict.get('Type') instanceof Name && o.value.dict.get('Type').v === 'ObjStm');
      streams.sort((a, b) => a.pos - b.pos);
      for (const o of streams) {
        try {
          const data = this.decodeStream(o.value);
          const txt = bytesToLatin1(data);
          const n = this.resolve(o.value.dict.get('N'));
          const first = this.resolve(o.value.dict.get('First'));
          if (typeof n !== 'number' || typeof first !== 'number') continue;
          const head = new Parser(txt);
          const pairs = [];
          for (let i = 0; i < n; i++) {
            const num = head.token();
            const off = head.token();
            if (typeof num !== 'number' || typeof off !== 'number') break;
            pairs.push([num, off]);
          }
          pairs.forEach(([num, off], i) => {
            try {
              const p = new Parser(txt);
              p.p = first + off;
              const v = p.object();
              this.define(num, 0, o.pos + (i + 1) / (pairs.length + 1), v);
            } catch (e) {
              /* skip one broken object */
            }
          });
        } catch (e) {
          this.warnings.push(`Could not unpack object stream ${o.num}: ${e.message}`);
        }
      }
    }

    decodeStream(st) {
      const raw = this.bytes.subarray(st.dataStart, st.dataEnd);
      let filters = this.resolve(st.dict.get('Filter'));
      if (filters == null) return raw;
      if (!Array.isArray(filters)) filters = [filters];
      let parms = this.resolve(st.dict.get('DecodeParms'));
      if (!Array.isArray(parms)) parms = [parms];
      let data = raw;
      for (let i = 0; i < filters.length; i++) {
        const f = this.resolve(filters[i]);
        const name = f instanceof Name ? f.v : '';
        if (name === 'FlateDecode' || name === 'Fl') {
          data = inflate(data);
          const pm = this.resolve(parms[i]);
          if (pm instanceof Dict) {
            const pred = this.resolve(pm.get('Predictor')) || 1;
            if (pred >= 10) data = unpredict(data, this.resolve(pm.get('Columns')) || 1, this.resolve(pm.get('Colors')) || 1, this.resolve(pm.get('BitsPerComponent')) || 8);
            else if (pred !== 1) throw new Error('unsupported predictor ' + pred);
          }
        } else {
          throw new Error('unsupported filter /' + name);
        }
      }
      return data;
    }

    // Walk the page tree. Returns [{ ref, dict, parentRef, inherited, inheritedFromRoot }],
    // where `inherited` holds the nearest ancestor's value of each inheritable attribute and
    // `inheritedFromRoot[k]` is true when that ancestor is the root itself.
    pages() {
      const INHERIT = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
      let catalog = this.resolve(this.trailer.get('Root'));
      if (!(catalog instanceof Dict) || !catalog.has('Pages')) {
        // No usable trailer: look for a catalog object directly.
        let best = null;
        for (const o of this.objs.values()) {
          if (o.value instanceof Dict && o.value.get('Type') instanceof Name && o.value.get('Type').v === 'Catalog' && (!best || o.pos > best.pos)) best = o;
        }
        if (!best) throw new Error(this.trailer.has('Encrypt') ? ENCRYPTED_STRUCTURE : 'No document catalog found: this does not look like a readable PDF.');
        catalog = best.value;
        if (!this.trailer.has('Root')) this.trailer.set('Root', new Ref(best.num, best.gen));
      }
      const rootRef = catalog.get('Pages');
      if (!(rootRef instanceof Ref)) throw new Error('The catalog has no /Pages reference.');
      const root = this.resolve(rootRef);
      if (!(root instanceof Dict)) throw new Error(this.trailer.has('Encrypt') ? ENCRYPTED_STRUCTURE : 'The page tree root could not be found.');
      const out = [];
      const seen = new Set();
      const walk = (ref, node, inherited, fromRoot, depth) => {
        if (depth > 64) throw new Error('page tree too deep');
        if (!(node instanceof Dict)) return;
        const type = node.get('Type') instanceof Name ? node.get('Type').v : '';
        const kids = this.resolve(node.get('Kids'));
        if (type !== 'Page' && Array.isArray(kids)) {
          const inh = Object.assign({}, inherited);
          const fr = Object.assign({}, fromRoot);
          for (const k of INHERIT) {
            if (node.has(k)) {
              inh[k] = node.get(k);
              fr[k] = depth === 0;
            }
          }
          for (const kid of kids) {
            if (!(kid instanceof Ref)) continue;
            if (seen.has(kid.num)) continue;
            seen.add(kid.num);
            walk(kid, this.resolve(kid), inh, fr, depth + 1);
          }
        } else if (type === 'Page' || !node.has('Kids')) {
          if (!(ref instanceof Ref)) return;
          out.push({ ref, dict: node, parentRef: node.get('Parent'), inherited, inheritedFromRoot: fromRoot });
        }
      };
      walk(rootRef, root, {}, {}, 0);
      return { rootRef, root, pages: out, catalog };
    }
  }

  const encryptedEarly = (doc) => doc.trailer.has('Encrypt');

  function load(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (!/%PDF-\d/.test(bytesToLatin1(bytes.subarray(0, 1024)))) throw new Error('This is not a PDF file (no %PDF header).');
    const doc = new Doc(bytes);
    doc.scan();
    doc.unpackObjectStreams();
    return doc;
  }

  function inspect(bytes) {
    const doc = load(bytes);
    const tree = doc.pages();
    return {
      pages: tree.pages.length,
      encrypted: doc.trailer.has('Encrypt'),
      xrefStyle: doc.xrefStyle,
      warnings: doc.warnings,
    };
  }

  // newOrder: array of 1-based original page numbers; 0 means "a blank page here".
  // Returns { bytes, pages, written, warnings, xrefStyle }.
  function reorder(bytes, newOrder, opts) {
    const o = Object.assign({ blankSize: null }, opts || {});
    const doc = load(bytes);
    const tree = doc.pages();
    const pages = tree.pages;
    if (pages.length === 0) throw new Error(encryptedEarly(doc) ? ENCRYPTED_STRUCTURE : 'No pages found in this PDF.');
    for (const n of newOrder) {
      if (!Number.isInteger(n) || n < 0 || n > pages.length) throw new RangeError(`page ${n} is out of range (the file has ${pages.length} pages)`);
    }
    const encrypted = doc.trailer.has('Encrypt');
    const rootRef = tree.rootRef;
    const rootObj = doc.objs.get(rootRef.num);
    if (!rootObj || !(rootObj.value instanceof Dict)) throw new Error('The page tree root is not a plain dictionary.');

    // First page's effective box and rotation, for the blanks.
    const p0 = pages[0];
    const eff = (k) => (p0.dict.has(k) ? p0.dict.get(k) : p0.inherited[k]);
    let mediaBox = doc.resolve(eff('MediaBox'));
    if (!Array.isArray(mediaBox) || mediaBox.length !== 4) mediaBox = [0, 0, 612, 792];
    mediaBox = mediaBox.map((v) => (typeof doc.resolve(v) === 'number' ? doc.resolve(v) : 0));
    if (Array.isArray(o.blankSize) && o.blankSize.length === 4) mediaBox = o.blankSize;
    const rotate = doc.resolve(eff('Rotate'));

    const newObjs = []; // { num, gen, body }
    let nextNum = doc.maxNum + 1;
    const kids = [];
    const rewritten = new Set();
    let blanks = 0;
    for (const n of newOrder) {
      if (n === 0) {
        const d = new Dict();
        d.set('Type', new Name('/Page'));
        d.set('Parent', rootRef);
        d.set('MediaBox', mediaBox);
        d.set('Resources', new Dict()); // required by the spec even for an empty page; strict checkers notice
        if (typeof rotate === 'number' && rotate !== 0) d.set('Rotate', rotate);
        const num = nextNum++;
        newObjs.push({ num, gen: 0, body: serialize(d) });
        kids.push(new Ref(num, 0));
        blanks++;
        continue;
      }
      const pg = pages[n - 1];
      kids.push(pg.ref);
      const parentIsRoot = pg.parentRef instanceof Ref && pg.parentRef.num === rootRef.num;
      // Attributes the page inherits from an in-between node must be written into it, because
      // its new parent is the root. Anything it inherits from the root itself it keeps inheriting.
      const needs = Object.keys(pg.inherited).filter((k) => !pg.dict.has(k) && !pg.inheritedFromRoot[k]);
      if (!parentIsRoot || needs.length) {
        if (rewritten.has(pg.ref.num)) continue;
        rewritten.add(pg.ref.num);
        const d = pg.dict.clone();
        d.set('Parent', rootRef);
        for (const k of needs) d.set(k, pg.inherited[k]);
        if (encrypted && containsString(d)) {
          throw new Error('This PDF is encrypted and one of its pages would need rewriting; print it to a new PDF first.');
        }
        const orig = doc.objs.get(pg.ref.num);
        newObjs.push({ num: pg.ref.num, gen: orig ? orig.gen : pg.ref.gen, body: serialize(d) });
      }
    }
    const newRoot = rootObj.value.clone();
    newRoot.set('Kids', kids);
    newRoot.set('Count', kids.length);
    if (encrypted && containsString(newRoot)) throw new Error('This PDF is encrypted in a way Quire cannot update; print it to a new PDF first.');
    newObjs.push({ num: rootRef.num, gen: rootObj.gen, body: serialize(newRoot) });

    // ---- write the update ----
    const parts = [];
    let pos = bytes.length;
    const push = (s) => {
      parts.push(s);
      pos += typeof s === 'string' ? s.length : s.length;
    };
    const lastByte = bytes[bytes.length - 1];
    if (lastByte !== 0x0a && lastByte !== 0x0d) push('\n');
    const offsets = new Map();
    for (const ob of newObjs) {
      offsets.set(ob.num, { offset: pos, gen: ob.gen });
      push(`${ob.num} ${ob.gen} obj\n${ob.body}\nendobj\n`);
    }
    const size = Math.max(doc.maxNum, nextNum - 1, typeof doc.resolve(doc.trailer.get('Size')) === 'number' ? doc.resolve(doc.trailer.get('Size')) - 1 : 0) + 1;
    const trailerEntries = () => {
      let s = ` /Root ${serialize(doc.trailer.get('Root'))}`;
      if (doc.trailer.has('Info')) s += ` /Info ${serialize(doc.trailer.get('Info'))}`;
      if (doc.trailer.has('ID')) s += ` /ID ${serialize(doc.trailer.get('ID'))}`;
      if (doc.trailer.has('Encrypt')) s += ` /Encrypt ${serialize(doc.trailer.get('Encrypt'))}`;
      if (doc.prev !== null) s += ` /Prev ${doc.prev}`;
      return s;
    };
    let startxref;
    if (doc.xrefStyle === 'table') {
      startxref = pos;
      let s = 'xref\n';
      const nums = [...offsets.keys()].sort((a, b) => a - b);
      let i = 0;
      while (i < nums.length) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        s += `${nums[i]} ${j - i + 1}\n`;
        for (let k = i; k <= j; k++) {
          const e = offsets.get(nums[k]);
          s += `${String(e.offset).padStart(10, '0')} ${String(e.gen).padStart(5, '0')} n\r\n`;
        }
        i = j + 1;
      }
      s += `trailer\n<< /Size ${size}${trailerEntries()} >>\n`;
      push(s);
    } else {
      const xnum = nextNum++;
      startxref = pos;
      offsets.set(xnum, { offset: pos, gen: 0 });
      const nums = [...offsets.keys()].sort((a, b) => a - b);
      const index = [];
      let i = 0;
      while (i < nums.length) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        index.push(nums[i], j - i + 1);
        i = j + 1;
      }
      const data = new Uint8Array(nums.length * 7);
      nums.forEach((n, k) => {
        const e = offsets.get(n);
        const b = k * 7;
        data[b] = 1;
        data[b + 1] = (e.offset >>> 24) & 0xff;
        data[b + 2] = (e.offset >>> 16) & 0xff;
        data[b + 3] = (e.offset >>> 8) & 0xff;
        data[b + 4] = e.offset & 0xff;
        data[b + 5] = (e.gen >> 8) & 0xff;
        data[b + 6] = e.gen & 0xff;
      });
      const sz = Math.max(size, xnum + 1);
      push(`${xnum} 0 obj\n<< /Type /XRef /Size ${sz} /W [1 4 2] /Index [${index.join(' ')}]${trailerEntries()} /Length ${data.length} >>\nstream\n`);
      push(data);
      push('\nendstream\nendobj\n');
    }
    push(`startxref\n${startxref}\n%%EOF\n`);

    const total = pos;
    const out = new Uint8Array(total);
    out.set(bytes, 0);
    let at = bytes.length;
    for (const p of parts) {
      const b = typeof p === 'string' ? latin1ToBytes(p) : p;
      out.set(b, at);
      at += b.length;
    }
    return {
      bytes: out,
      pages: pages.length,
      written: newObjs.length,
      blanks,
      rewrittenPages: rewritten.size,
      xrefStyle: doc.xrefStyle,
      encrypted,
      warnings: doc.warnings,
    };
  }

  return { load, inspect, reorder, bytesToLatin1, latin1ToBytes, Parser, Dict, Name, Ref, Str, Stream, serialize, inflate, inflateRaw, unpredict };
});
