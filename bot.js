// ============================================================================
// PolyTrack Optimize — an in-game bot that completes tracks as fast as possible
// ============================================================================
//
// HOW IT WORKS
//
// The game runs all physics in a dedicated worker (simulation_worker.bundle.js)
// driven by a tiny message protocol (Init/CreateCar/StartCar/UpdateResult...).
// This bot taps that worker passively and never modifies the game's messages:
//
//   1. OBSERVE  While you drive, it watches the simulation states (frame count,
//               finish frame, current key state) and records your inputs as a
//               baseline replay.
//
//   2. OPTIMIZE It then hill-climbs on that baseline: random mutations (add,
//               remove, shift or tap inputs) are evaluated in PARALLEL headless
//               simulator workers. The simulator is deterministic, so every
//               candidate's exact finish frame is known — no guessing.
//
//   3. PILOT    Once a best replay exists, every new attempt is driven by the
//               bot: it dispatches synthetic key events following the best
//               replay, frame by frame, while the search keeps improving in
//               the background. Each finished run adopts the actually-driven
//               inputs as the new baseline, so results keep improving.
//
// Replays use the game's own recording format (5 channels — up/right/down/
// left/reset — each a sorted list of frame numbers, 60 frames = 1 second).
// Your best replay per track is saved in localStorage and restored on reload.
//
// Controls (panel, bottom-left): Search start/stop · Pilot on/off · Clear best.
// Finish a track once manually — from then on the bot drives.

(function () {
  "use strict";

  if (window.__PT_BOT__) return;
  window.__PT_BOT__ = true;
  var TAG = "[pt-bot]";

  function err(e) { try { console.error(TAG, e); } catch (x) {} }

  // ------------------------------------------------------------- constants
  var Jo = { Init: 0, Verify: 1, TestDeterminism: 2, CreateCar: 3, DeleteCar: 4,
             StartCar: 5, ControlCar: 6, PauseCar: 7, VerifyResult: 8,
             DeterminismResult: 9, UpdateResult: 10 };

  var UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3, RESET = 4;
  var CHAN = ["up", "right", "down", "left", "reset"];
  var DEFAULT_BIND = ["KeyW", "KeyD", "KeyS", "KeyA", "KeyR"];
  var DEFAULT_KEY = ["w", "d", "s", "a", "r"];

  var NativeWorker = window.Worker;
  var POP = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
  var BUDGET_MS = 60000;        // search budget per activation
  var HARD_LIMIT = 36000;       // max simulated frames per candidate (10 min)
  var MARGIN = 900;             // prune candidates slower than best + margin

  // ---------------------------------------------------------------- codec
  function newRec() { return [[], [], [], [], []]; }
  function cloneRec(r) { var o = [], c; for (c = 0; c < 5; c++) o.push(r[c].slice()); return o; }
  function numAsc(a, b) { return a - b; }

  function encChan(ch) {
    var b = new Uint8Array(3 + 3 * ch.length);
    b[0] = ch.length & 255; b[1] = (ch.length >>> 8) & 255; b[2] = (ch.length >>> 16) & 255;
    for (var i = 0; i < ch.length; i++) {
      var d = i === 0 ? ch[i] : ch[i] - ch[i - 1];
      b[3 + 3 * i] = d & 255; b[3 + 3 * i + 1] = (d >>> 8) & 255; b[3 + 3 * i + 2] = (d >>> 16) & 255;
    }
    return b;
  }

  function serializeRec(chans) {
    try {
      var parts = [encChan(chans[UP]), encChan(chans[RIGHT]), encChan(chans[DOWN]),
                   encChan(chans[LEFT]), encChan(chans[RESET])];
      var total = 0, i;
      for (i = 0; i < parts.length; i++) total += parts[i].length;
      var raw = new Uint8Array(total), o = 0;
      for (i = 0; i < parts.length; i++) { raw.set(parts[i], o); o += parts[i].length; }
      var bytes = deflate(raw);
      var b64 = base64(bytes);
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) { err(e); return null; }
  }

  function base64(bytes) {
    var CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var k = 0; k < bytes.length; k += 3) {
      var b1 = bytes[k], b2 = k + 1 < bytes.length ? bytes[k + 1] : 0, b3 = k + 2 < bytes.length ? bytes[k + 2] : 0;
      out += CH[b1 >> 2] + CH[((b1 & 3) << 4) | (b2 >> 4)] + CH[((b2 & 15) << 2) | (b3 >> 6)] + CH[b3 & 63];
    }
    var pad = [0, 2, 1, 0][bytes.length % 3];
    return out.slice(0, out.length - pad);
  }

  // Minimal zlib (deflate) encoder with fixed Huffman codes + greedy LZ77.
  // Output is a standard zlib stream — verified against inflaters.
  var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var litCode = new Uint16Array(288), litLen = new Uint8Array(288);
  (function () {
    for (var s = 0; s < 288; s++) {
      if (s < 144) { litCode[s] = 0x30 + s; litLen[s] = 8; }
      else if (s < 256) { litCode[s] = 0x190 + s - 144; litLen[s] = 9; }
      else if (s < 280) { litCode[s] = s - 256; litLen[s] = 7; }
      else { litCode[s] = 0xc0 + s - 280; litLen[s] = 8; }
    }
  })();

  function BitWriter() {
    var buf = new Uint8Array(1024), bitPos = 0;
    function ensure(n) {
      var need = ((bitPos + n + 7) >> 3);
      if (need > buf.length) {
        var nb = new Uint8Array(Math.max(need, buf.length * 2));
        nb.set(buf); buf = nb;
      }
    }
    return {
      bits: function (v, n) { ensure(n); for (var i = 0; i < n; i++) { if ((v >>> i) & 1) buf[bitPos >> 3] |= 1 << (bitPos & 7); bitPos++; } },
      huff: function (v, n) { ensure(n); for (var i = n - 1; i >= 0; i--) { if ((v >>> i) & 1) buf[bitPos >> 3] |= 1 << (bitPos & 7); bitPos++; } },
      align: function () { bitPos = (bitPos + 7) & ~7; },
      bytes: function () { this.align(); return buf.subarray(0, bitPos >> 3); }
    };
  }

  function adler32(d) {
    var a = 1, b = 0, i;
    var A = a % 65521, B = 0;
    for (i = 0; i < d.length; i++) { A = (A + d[i]) % 65521; B = (B + A) % 65521; }
    return ((B << 16) | A) >>> 0;
  }

  function deflate(input) {
    var bw = BitWriter();
    var head = new Int32Array(1 << 15), prev = new Int32Array(input.length);
    head.fill(-1);
    function hash3(a, b, c) { return (((a << 10) ^ (b << 5) ^ c) & 32767); }
    function insert(p) {
      if (p + 2 >= input.length) return;
      var h = hash3(input[p], input[p + 1], input[p + 2]);
      prev[p] = head[h]; head[h] = p;
    }
    function findMatch(p) {
      if (p + 3 > input.length) return null;
      var maxLen = Math.min(258, input.length - p);
      if (maxLen < 3) return null;
      var h = hash3(input[p], input[p + 1], input[p + 2]);
      var cand = head[h], bestLen = 0, bestDist = 0, chain = 0;
      while (cand >= 0 && p - cand <= 32768 && chain++ < 128) {
        var l = 0;
        while (l < maxLen && input[cand + l] === input[p + l]) l++;
        if (l > bestLen) { bestLen = l; bestDist = p - cand; if (l >= maxLen) break; }
        cand = prev[cand];
      }
      return bestLen >= 3 ? [bestLen, bestDist] : null;
    }
    bw.bits(1, 1); bw.bits(1, 2);                // BFINAL=1, BTYPE=01 (fixed)
    var i = 0;
    while (i < input.length) {
      var m = findMatch(i);
      if (m) {
        var len = m[0], dist = m[1], t, u;
        var lsym = 28; for (t = 28; t >= 0; t--) { if (LEN_BASE[t] <= len) { lsym = t; break; } }
        var dsym = 29; for (u = 29; u >= 0; u--) { if (DIST_BASE[u] <= dist) { dsym = u; break; } }
        bw.huff(litCode[257 + lsym], litLen[257 + lsym]);
        bw.bits(len - LEN_BASE[lsym], LEN_EXTRA[lsym]);
        bw.huff(dsym, 5);
        bw.bits(dist - DIST_BASE[dsym], DIST_EXTRA[dsym]);
        for (var k = 0; k < len; k++) insert(i + k);
        i += len;
      } else {
        bw.huff(litCode[input[i]], litLen[input[i]]);
        insert(i);
        i++;
      }
    }
    bw.huff(litCode[256], litLen[256]);          // end of block
    var body = bw.bytes();
    var ad = adler32(input);
    var out = new Uint8Array(body.length + 6);
    out.set(body, 2);
    out[0] = 0x78; out[1] = 0x9c;
    out[out.length - 4] = (ad >>> 24) & 255; out[out.length - 3] = (ad >>> 16) & 255;
    out[out.length - 2] = (ad >>> 8) & 255; out[out.length - 1] = ad & 255;
    return out;
  }

  function recStateAll(rec, f) {
    var o = [], c;
    for (c = 0; c < 5; c++) {
      var a = rec[c], on = false, i;
      for (i = 0; i < a.length; i++) { if (a[i] <= f) on = !on; else break; }
      o.push(on);
    }
    return o;
  }

  function insertSorted(a, f) {
    var lo = 0, hi = a.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < f) lo = m + 1; else hi = m; }
    a.splice(lo, 0, f);
  }

  function nearestEdge(a, f, tol) {
    var lo = 0, hi = a.length;
    while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < f) lo = m + 1; else hi = m; }
    var best = -1, bd = 1e9;
    if (lo < a.length && Math.abs(a[lo] - f) <= tol) { best = lo; bd = Math.abs(a[lo] - f); }
    if (lo > 0 && Math.abs(a[lo - 1] - f) < bd) { best = lo - 1; }
    return best;
  }

  function sanitize(r) {
    for (var c = 0; c < 5; c++) {
      var a = r[c];
      a.sort(numAsc);
      var out = [];
      for (var i = 0; i < a.length; i++) {
        if (a[i] < 0 || a[i] > 5999999) continue;
        if (out.length && out[out.length - 1] === a[i]) continue;
        out.push(a[i]);
      }
      r[c] = out;
    }
    return r;
  }

  function pickChan() {
    var r = Math.random();
    if (r < 0.30) return RIGHT;
    if (r < 0.60) return LEFT;
    if (r < 0.88) return UP;
    return DOWN; // reset channel is never mutated
  }

  function mutate(base, horizon) {
    var r = cloneRec(base);
    var c = pickChan(), a = r[c], roll = Math.random();
    if (roll < 0.5) {
      var f = Math.floor(Math.random() * horizon);
      var idx = nearestEdge(a, f, 10);
      if (idx >= 0) a.splice(idx, 1); else insertSorted(a, f);
    } else if (roll < 0.75) {
      var f2 = Math.floor(Math.random() * horizon);
      var len = c === UP ? (Math.random() < 0.25 ? 2 : 1) : 1 + Math.floor(Math.random() * 3);
      insertSorted(a, f2);
      insertSorted(a, f2 + len);
    } else if (roll < 0.9) {
      if (a.length) {
        var i = Math.floor(Math.random() * a.length);
        a[i] = Math.max(0, a[i] + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 6)));
      }
    } else {
      if (a.length) a.splice(Math.floor(Math.random() * a.length), 1);
    }
    return sanitize(r);
  }

  // ------------------------------------------------------------ bot state
  var trackParts = null, evalBase = null, baseHash = null, hashing = false;
  var playerCarId = null;
  var best = null, bestFrames = Infinity;
  var capRec = newRec(), capLast = { up: false, right: false, down: false, left: false, reset: false };
  var prevFrames = -1;
  var pilotEnabled = true, pilotActive = false, pilotSync = false, pilotLast = null;
  var learnedBind = [null, null, null, null, null];
  var search = { running: false, stop: false, gen: 0, deadline: 0 };
  var epoch = 0; // bumped on track switch; stale eval results are ignored

  function fmt(frames) { return frames === Infinity ? "—" : (frames / 60).toFixed(3) + "s"; }

  // ---------------------------------------------------- worker observation
  window.Worker = new Proxy(NativeWorker, {
    construct: function (Target, args) {
      var w = new Target(args[0], args[1]);
      try { if (String(args[0]).indexOf("simulation_worker") !== -1) observeSim(w); } catch (e) { err(e); }
      return w;
    }
  });

  function observeSim(w) {
    var origPost = w.postMessage.bind(w);
    w.postMessage = function (msg) {
      try {
        if (msg && msg.messageType === Jo.Init && msg.trackParts) {
          trackParts = msg.trackParts;
        } else if (msg && msg.messageType === Jo.CreateCar && msg.carRecording == null) {
          onPlayerCarMsg(msg);
        } else if (msg && msg.messageType === Jo.DeleteCar && msg.carId === playerCarId) {
          pilotActive = false; updateHud(true);
        }
      } catch (e) { err(e); }
      return origPost.apply(null, arguments);
    };
    w.addEventListener("message", function (ev) {
      try { onWorkerMsg(ev.data); } catch (e) { err(e); }
    });
  }

  function onPlayerCarMsg(msg) {
    playerCarId = msg.carId;
    var prevTrack = evalBase && evalBase.trackData;
    evalBase = {};
    for (var k in msg) if (k !== "carRecording" && k !== "carId") evalBase[k] = msg[k];
    if (prevTrack !== evalBase.trackData) {
      // New track: drop cached state, stop the search, let eval workers re-init.
      baseHash = null;
      best = null; bestFrames = Infinity;
      bestDecoded = null; gameRec = false;
      prevFrames = -1;
      epoch++; // invalidate any in-flight evals from the previous track
      logLines.length = 0;
      pool.resetTrack();
      if (search.running) search.stop = true;
    }
    if (!best) {
      capRec = newRec();
      capLast = { up: false, right: false, down: false, left: false, reset: false };
    }
    loadBest();
    updateHud(true);
  }

  function onWorkerMsg(m) {
    if (!m || m.messageType !== Jo.UpdateResult || !m.carStates) return;
    for (var i = 0; i < m.carStates.length; i++) {
      var s = m.carStates[i];
      if (s.id !== playerCarId) continue;
      onPlayerState(s);
    }
  }

  function onPlayerState(s) {
    if (s.frames < prevFrames) onNewAttempt();
    prevFrames = s.frames;

    if (pilotActive && best) pilotStep(s);
    captureControls(s);

    if (s.finishFrames != null) onRunFinished(s.finishFrames);
    updateHud(false);
  }

  var warnedSynthetic = false;
  var runReported = false;
  function onNewAttempt() {
    if (pilotSync) {
      var total = capRec[UP].length + capRec[RIGHT].length + capRec[DOWN].length +
                  capRec[LEFT].length + capRec[RESET].length;
      if (pilotActive && total === 0 && !warnedSynthetic) {
        warnedSynthetic = true;
        log("synthetic keys seem blocked — drive a baseline manually");
      }
    }
    capRec = newRec();
    capLast = { up: false, right: false, down: false, left: false, reset: false };
    pilotActive = pilotEnabled && !!best;
    pilotSync = false;
    prevFrames = 0;
    runReported = false;
  }

  function captureControls(s) {
    var st = s.controls;
    if (!st) return;
    for (var c = 0; c < 5; c++) {
      var k = CHAN[c], v = !!st[k];
      if (v !== capLast[k]) {
        capRec[c].push(s.frames);
        capLast[k] = v;
        if (v) learnBind(c);
      }
    }
  }

  function decodeGameRecording(str) {
    try {
      var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var raw = inflateZlib(bytes);
      function chan(off) {
        if (off + 3 > raw.length) return null;
        var n = raw[off] | raw[off + 1] << 8 | raw[off + 2] << 16;
        if (off + 3 + 3 * n > raw.length) return null;
        var a = [], prev = 0;
        for (var j = 0; j < n; j++) {
          var d = raw[off + 3 + 3 * j] | raw[off + 3 + 3 * j + 1] << 8 | raw[off + 3 + 3 * j + 2] << 16;
          var v = j === 0 ? d : prev + d;
          a.push(v); prev = v;
        }
        return a;
      }
      var o = 0, out = [];
      for (var c = 0; c < 5; c++) {
        var ch = chan(o);
        if (ch == null) return null;
        out.push(ch); o += 3 + 3 * ch.length;
      }
      return out;
    } catch (e) { return null; }
  }

  function inflateZlib(bytes) {
    // Parse a zlib stream: 2-byte header, then raw DEFLATE blocks, then adler32.
    var pos = 2;
    var out = [];
    var bitBuf = 0, bitCnt = 0;
    function bits(n) {
      while (bitCnt < n) { bitBuf |= bytes[pos++] << bitCnt; bitCnt += 8; }
      var v = bitBuf & ((1 << n) - 1); bitBuf >>>= n; bitCnt -= n; return v;
    }
    // fixed-Huffman decode tables
    var LEN_BASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LEN_EXTRA=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DIST_BASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var DIST_EXTRA=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    function buildHuff(lens) {
      var maxLen = 0, i;
      for (i = 0; i < lens.length; i++) if (lens[i] > maxLen) maxLen = lens[i];
      var blcount = new Array(maxLen + 1).fill(0);
      for (i = 0; i < lens.length; i++) if (lens[i]) blcount[lens[i]]++;
      var nextCode = [0], code = 0;
      for (i = 1; i <= maxLen; i++) { code = (code + blcount[i - 1]) << 1; nextCode[i] = code; }
      var map = {};
      for (i = 0; i < lens.length; i++) if (lens[i]) map[nextCode[lens[i]]++] = { sym: i, len: lens[i] };
      return map;
    }
    var fixedLit = buildHuff((function () {
      var l = [];
      for (var i = 0; i < 288; i++) l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8);
      return l;
    })());
    var fixedDist = buildHuff(new Array(30).fill(5));
    function decodeSym(map) {
      var code = 0, len = 0;
      while (true) {
        code = (code << 1) | bits(1); len++;
        if (map[code] && map[code].len === len) return map[code].sym;
        if (len > 15) throw new Error("bad huffman");
      }
    }
    function dynTables() {
      var order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      var clLens = new Array(19).fill(0);
      for (var i = 0; i < hclen; i++) clLens[order[i]] = bits(3);
      var clMap = buildHuff(clLens);
      var lens = [];
      while (lens.length < hlit + hdist) {
        var sym = decodeSym(clMap);
        if (sym < 16) { lens.push(sym); continue; }
        var rep, val;
        if (sym === 16) { rep = 3 + bits(2); val = lens[lens.length - 1]; }
        else if (sym === 17) { rep = 3 + bits(3); val = 0; }
        else { rep = 11 + bits(7); val = 0; }
        while (rep--) lens.push(val);
      }
      return [buildHuff(lens.slice(0, hlit)), buildHuff(lens.slice(hlit))];
    }
    var last = -1;
    while (true) {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0;
        var lo = bytes[pos] | bytes[pos + 1] << 8, hi = bytes[pos + 2] | bytes[pos + 3] << 8;
        pos += 4;
        for (var i = 0; i < lo; i++) out.push(bytes[pos++]);
      } else if (type === 1 || type === 2) {
        var lit, dist;
        if (type === 1) { lit = fixedLit; dist = fixedDist; }
        else { var t = dynTables(); lit = t[0]; dist = t[1]; }
        while (true) {
          var sym = decodeSym(lit);
          if (sym === 256) break;
          if (sym < 256) { out.push(sym); continue; }
          var li = sym - 257, len = LEN_BASE[li] + (LEN_EXTRA[li] ? bits(LEN_EXTRA[li]) : 0);
          var ds = decodeSym(dist), di = ds;
          var distance = DIST_BASE[di] + (DIST_EXTRA[di] ? bits(DIST_EXTRA[di]) : 0);
          for (var k = 0; k < len; k++) out.push(out[out.length - distance]);
        }
      } else throw new Error("bad block type");
      if (last) break;
    }
    return new Uint8Array(out);
  }

  // Game-provided recordings (hooked in index.html's upload shim): the exact
  // serialized replay the game itself produced — always evaluates correctly.
  window.__ptGameRecording = function (trackId, recording, frames) {
    if (typeof recording !== "string" || !recording.length || frames == null) return;
    if (best == null || frames < bestFrames) {
      best = recording; // opaque string, passed straight to eval
      bestFrames = frames;
      bestDecoded = decodeGameRecording(recording); // for pilot + mutation
      gameRec = true;
      persist();
      log("new best " + fmt(frames) + " (game replay)");
    }
  };
  var gameRec = false;

  function onRunFinished(frames) {
    if (runReported) return; // finish states repeat every frame after the run
    runReported = true;
    pilotActive = false;
    var hasInputs = capRec[UP].length + capRec[RIGHT].length + capRec[DOWN].length +
                    capRec[LEFT].length + capRec[RESET].length > 0;
    if (hasInputs && !gameRec && (best == null || frames < bestFrames)) {
      best = cloneRec(capRec);
      bestFrames = frames;
      persist();
      log("new best " + fmt(frames));
    }
    if (autoSearch && !search.running) startSearch();
    updateHud(true);
  }

  // ------------------------------------------------------------ key learner
  var lastKeyDown = { code: null, t: 0 };
  window.addEventListener("keydown", function (e) {
    if (e.__ptbot) return;
    lastKeyDown = { code: e.code, t: performance.now() };
  }, true);

  function learnBind(c) {
    if (learnedBind[c]) return;
    if (lastKeyDown.code && performance.now() - lastKeyDown.t < 150) {
      learnedBind[c] = lastKeyDown.code;
      log("learned " + CHAN[c] + " = " + lastKeyDown.code);
    }
  }

  // ------------------------------------------------------------------ pilot
  function dispatch(c, on) {
    var code = learnedBind[c] || DEFAULT_BIND[c];
    if (!code) return;
    var ev;
    try {
      ev = new KeyboardEvent(on ? "keydown" : "keyup",
        { code: code, key: DEFAULT_KEY[c], bubbles: true, cancelable: true });
      ev.__ptbot = true;
    } catch (e) { return; }
    (document.body || document).dispatchEvent(ev);
  }

  var bestDecoded = null; // decoded channels for the game-replay best (for pilot + mutation)
  function pilotStep(s) {
    if (!pilotSync) {
      pilotLast = { up: !!s.controls.up, right: !!s.controls.right, down: !!s.controls.down,
                    left: !!s.controls.left, reset: !!s.controls.reset };
      pilotSync = true;
    }
    if (gameRec ? !bestDecoded : !best) return; // waiting on decode
    var des = recStateAll(gameRec ? bestDecoded : best, s.frames + 1);
    for (var c = 0; c < 5; c++) {
      var k = CHAN[c];
      if (des[c] !== pilotLast[k]) {
        dispatch(c, des[c]);
        pilotLast[k] = des[c];
      }
    }
  }

  // -------------------------------------------------------------- eval pool
  var evalQueue = [], evalGen = 0;
  var pool = (function () {
    var slots = [];
    for (var i = 0; i < POP; i++) slots.push({ w: null, gen: -1, busy: false, cb: null, carId: 0, target: 0, watchdog: null });

    function ensureWorker(s) {
      if (s.w) return;
      s.w = new NativeWorker("simulation_worker.bundle.js");
      s.gen = -1;
      s.w.onmessage = function (ev) { onMsg(s, ev.data); };
      s.w.onerror = function () { fail(s); };
    }

    function onMsg(s, m) {
      if (!s.busy || !m || m.messageType !== Jo.UpdateResult || !m.carStates) return;
      for (var i = 0; i < m.carStates.length; i++) {
        var st = m.carStates[i];
        if (st.id !== s.carId) continue;
        if (st.finishFrames != null) done(s, st.finishFrames);
        else if (st.frames >= s.target) done(s, null);
      }
    }

    function done(s, result) {
      if (!s.busy) return;
      clearTimeout(s.watchdog); s.watchdog = null;
      s.busy = false;
      try { s.w.postMessage({ messageType: Jo.DeleteCar, carId: s.carId }); } catch (e) {}
      var cb = s.cb; s.cb = null;
      if (cb) cb(result);
      pump();
    }

    function fail(s) {
      if (!s.busy) return;
      clearTimeout(s.watchdog); s.watchdog = null;
      s.busy = false;
      try { s.w.terminate(); } catch (e) {}
      s.w = null;
      var cb = s.cb; s.cb = null;
      if (cb) cb(null);
      pump();
    }

    function run(s, recStr, target, cb) {
      ensureWorker(s);
      s.busy = true; s.cb = cb; s.carId++; s.target = target;
      if (s.gen !== evalGen) {
        s.gen = evalGen;
        s.w.postMessage({ messageType: Jo.Init, isRealtime: false, trackParts: trackParts });
      }
      var cm = {};
      for (var k in evalBase) cm[k] = evalBase[k];
      cm.messageType = Jo.CreateCar;
      cm.carId = s.carId;
      cm.carRecording = recStr;
      s.w.postMessage(cm);
      s.w.postMessage({ messageType: Jo.StartCar, carId: s.carId, targetSimulationTimeFrames: target });
      s.watchdog = setTimeout(function () { fail(s); }, 90000);
    }

    function freeSlot() {
      for (var i = 0; i < slots.length; i++) if (!slots[i].busy) return slots[i];
      return null;
    }

    function pump() {
      while (evalQueue.length) {
        var s = freeSlot();
        if (!s) return;
        var j = evalQueue.shift();
        run(s, j.recStr, j.target, j.cb);
      }
    }

    return {
      eval: function (recStr, target, cb) {
        if (!trackParts || !evalBase) { cb(null); return; }
        var s = freeSlot();
        if (s) run(s, recStr, target, cb);
        else evalQueue.push({ recStr: recStr, target: target, cb: cb });
      },
      resetTrack: function () { evalGen++; evalQueue.length = 0; }
    };
  })();

  // ----------------------------------------------------------------- search
  var autoSearch = true;

  function evalTarget() {
    return Math.min(HARD_LIMIT, (bestFrames === Infinity ? HARD_LIMIT : bestFrames + MARGIN));
  }

  function startSearch() {
    if (search.running) return;
    if (!best) { log("finish the track once to create a baseline"); return; }
    search.running = true; search.stop = false; search.gen = 0;
    search.deadline = performance.now() + BUDGET_MS;
    log("searching (pop " + POP + ")…");
    updateHud(true);
    var ep = epoch;
    pool.eval(typeof best === "string" ? best : serializeRec(best), evalTarget(), function (f) {
      if (ep !== epoch) { search.running = false; updateHud(true); return; }
      if (f == null) { search.running = false; log("baseline didn't finish in sim — aborted"); updateHud(true); return; }
      bestFrames = f;
      report();
      nextGen();
    });
  }

  function stopSearch() {
    if (search.running) { search.stop = true; log("search stopping…"); }
  }

  function nextGen() {
    if (search.stop || performance.now() > search.deadline || !best) {
      search.running = false;
      log("search done — best " + fmt(bestFrames));
      updateHud(true);
      return;
    }
    search.gen++;
    var ep = epoch;
    var cands = [], i;
    var baseRec = gameRec ? bestDecoded : best;
    if (baseRec) {
      for (i = 0; i < POP; i++) cands.push(mutate(baseRec, (bestFrames === Infinity ? HARD_LIMIT : bestFrames) + MARGIN));
    }
    var pending = cands.length, results = new Array(cands.length);
    cands.forEach(function (c, ci) {
      pool.eval(serializeRec(c), evalTarget(), function (f) {
        if (ep !== epoch) return; // stale results from a previous track
        results[ci] = f;
        if (--pending > 0) return;
        var bi = -1, bf = Infinity, k;
        for (k = 0; k < results.length; k++) if (results[k] != null && results[k] < bf) { bf = results[k]; bi = k; }
        if (ep !== epoch || search.stop || best == null) return; // track switched or best cleared mid-generation
        if (bi >= 0 && bf < bestFrames) {
          best = cands[bi]; bestFrames = bf;
          gameRec = false; // adopted a mutant: channels array now
          bestDecoded = null;
          report(); persist();
          log("gen " + search.gen + ": " + fmt(bf));
        }
        nextGen();
      });
    });
    updateHud(true);
  }

  // -------------------------------------------------------------- persistence
  function persist() {
    computeHash(function (k) {
      if (!k) return;
      try { localStorage.setItem("ptbot_" + k, JSON.stringify({ f: bestFrames, r: best })); } catch (e) {}
    });
  }

  function loadBest() {
    computeHash(function (k) {
      if (!k || baseHash !== k || best) return;
      try {
        var v = JSON.parse(localStorage.getItem("ptbot_" + k));
        if (v && v.r && typeof v.f === "number") {
          best = v.r; bestFrames = v.f;
          log("restored best " + fmt(v.f));
          updateHud();
        }
      } catch (e) {}
    });
  }

  function computeHash(cb) {
    if (baseHash) { cb(baseHash); return; }
    if (hashing || !evalBase || !evalBase.trackData) return;
    hashing = true;
    try {
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(evalBase.trackData)).then(function (buf) {
        var a = new Uint8Array(buf), s = "", i;
        for (i = 0; i < 10; i++) s += ("0" + a[i].toString(16)).slice(-2);
        baseHash = s; hashing = false;
        cb(s);
      })["catch"](function () { hashing = false; cb(null); });
    } catch (e) { hashing = false; cb(null); }
  }

  function clearBest() {
    if (search.running) { search.stop = true; }
    epoch++; // invalidate in-flight evals so a finishing generation can't resurrect the cleared best
    best = null; bestFrames = Infinity;
    bestDecoded = null; gameRec = false;
    computeHash(function (k) { if (k) { try { localStorage.removeItem("ptbot_" + k); } catch (e) {} } });
    log("best cleared — drive a fresh baseline");
    updateHud(true);
  }

  // --------------------------------------------------------------------- UI
  var panel = null, logLines = [];
  function log(t) {
    logLines.push(t);
    if (logLines.length > 7) logLines.shift();
    if (panel) panel.querySelector("#ptb-log").textContent = logLines.join("\n");
  }
  function report() {
    if (panel) panel.querySelector("#ptb-best").textContent = "best: " + fmt(bestFrames);
  }

  function buildHud() {
    if (panel) return;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;bottom:10px;left:10px;z-index:99999;background:rgba(10,10,14,.93);" +
      "border:1px solid #2a2a2e;border-radius:10px;padding:12px 14px;width:300px;max-width:92vw;" +
      "font:12px/1.5 ui-monospace,monospace;color:#ddd;user-select:none";
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
      '<span style="color:#e10600;font-weight:900;letter-spacing:2px">PT OPTIMIZE</span>' +
      '<span id="ptb-status" style="margin-left:auto;color:#888">idle</span></div>' +
      '<div id="ptb-best" style="color:#bbb;margin-bottom:6px">best: —</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:6px">' +
      '<button id="ptb-search" style="flex:1;background:#e10600;color:#fff;border:none;border-radius:6px;padding:6px;font: bold 11px sans-serif;cursor:pointer">SEARCH</button>' +
      '<button id="ptb-pilot" style="flex:1;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:6px;padding:6px;font:bold 11px sans-serif;cursor:pointer">PILOT: ON</button>' +
      '<button id="ptb-clear" style="flex:1;background:#1a1a1a;color:#ccc;border:1px solid #333;border-radius:6px;padding:6px;font:bold 11px sans-serif;cursor:pointer">CLEAR</button>' +
      '</div>' +
      '<div id="ptb-log" style="color:#7a7a80;white-space:pre-wrap;max-height:110px;overflow:auto;font-size:11px"></div>';
    document.body.appendChild(panel);
    panel.querySelector("#ptb-search").onclick = function () {
      if (search.running) stopSearch(); else startSearch();
    };
    panel.querySelector("#ptb-pilot").onclick = function () {
      pilotEnabled = !pilotEnabled;
      this.textContent = "PILOT: " + (pilotEnabled ? "ON" : "OFF");
      if (!pilotEnabled) pilotActive = false;
    };
    panel.querySelector("#ptb-clear").onclick = clearBest;
  }

  var lastHud = 0;
  function updateHud(force) {
    if (!panel) return;
    var now = performance.now();
    if (!force && now - lastHud < 250) return;
    lastHud = now;
    var st;
    if (search.running) st = "search gen " + search.gen;
    else if (pilotActive) st = "piloting";
    else if (best) st = "ready";
    else st = "drive a baseline";
    panel.querySelector("#ptb-status").textContent = st;
    panel.querySelector("#ptb-best").textContent = "best: " + fmt(bestFrames) +
      (pilotActive ? " · bot driving (hands off)" : "");
    panel.querySelector("#ptb-search").textContent = search.running ? "STOP" : "SEARCH";
  }

  // ---------------------------------------------------------------- bot gate
  // Password-protects the bot only (the game itself stays open). The correct
  // hash unlocks the panel for this browser session; a new tab asks again.
  // Client-side only — a determined user can read this file and bypass it.
  var BOT_HASH = "f95d0934eb4aae00b4b40cac45ae529f6d17d6bbc95029e4de31139b512d90aa";
  function sha256Hex(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      var a = new Uint8Array(buf), o = "", i;
      for (i = 0; i < a.length; i++) o += ("0" + a[i].toString(16)).slice(-2);
      return o;
    });
  }

  function botUnlocked() {
    try { return sessionStorage.getItem("ptbot_ok") === BOT_HASH; } catch (e) { return false; }
  }

  function buildGate() {
    if (document.getElementById("ptb-gate")) return;
    var g = document.createElement("div");
    g.id = "ptb-gate";
    g.style.cssText = "position:fixed;bottom:10px;left:10px;z-index:99999;background:rgba(10,10,14,.93);" +
      "border:1px solid #2a2a2e;border-radius:10px;padding:12px 14px;width:300px;max-width:92vw;" +
      "font:12px/1.5 ui-monospace,monospace;color:#ddd;user-select:none";
    g.innerHTML =
      '<div style="color:#e10600;font-weight:900;letter-spacing:2px;margin-bottom:6px">PT OPTIMIZE</div>' +
      '<input id="ptb-gate-pw" type="password" placeholder="bot password" autocomplete="off" ' +
      'style="width:100%;background:#0a0a0a;color:#fff;border:1px solid #333;border-radius:6px;padding:8px;font:12px ui-monospace,monospace;box-sizing:border-box;text-align:center" />' +
      '<div id="ptb-gate-err" style="color:#e10600;font-size:11px;margin-top:6px;min-height:14px"></div>';
    document.body.appendChild(g);
    var input = g.querySelector("#ptb-gate-pw"), errEl = g.querySelector("#ptb-gate-err");
    function tryUnlock() {
      sha256Hex(input.value).then(function (h) {
        if (h === BOT_HASH) {
          try { sessionStorage.setItem("ptbot_ok", h); } catch (e) {}
          g.remove();
          buildHud();
          log("PolyTrack Optimize loaded.");
          log("Finish a track once — the bot optimizes from there.");
          updateHud(true);
        } else {
          errEl.textContent = "wrong password";
          input.value = ""; input.focus();
        }
      });
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    input.focus();
  }

  var uiHidden = true; // start hidden; Shift+B shows it
  function setUiHidden(h) {
    uiHidden = h;
    var el = panel || document.getElementById("ptb-gate");
    if (el) el.style.display = h ? "none" : "";
  }
  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyB" && e.shiftKey && !e.__ptbot && !e.repeat) {
      setUiHidden(!uiHidden);
    }
  }, true);

  // ------------------------------------------------------------------- boot
  function boot() {
    setUiHidden(true); // hidden on startup — Shift+B to show
    if (botUnlocked()) {
      buildHud();
      log("PolyTrack Optimize loaded.");
      log("Finish a track once — the bot optimizes from there.");
    } else {
      buildGate();
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
