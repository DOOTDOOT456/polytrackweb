// ============================================================================
// PT Gate — session-only password gate for the game.
//
// Blocks casual access: until the correct password is entered in this browser
// session, the game bundles are never loaded and the page shows only the gate.
// The password hash is stored in sessionStorage (cleared when the tab closes),
// so a new tab always asks again.
//
// NOTE: this is client-side only — a determined user can read this file and
// bypass it. It is a speed bump, not real security.
//
// To change the password: set the password below, then compute the hash and
// update ACCESS_HASH, e.g. in a browser console:
//   (async () => { const d = await crypto.subtle.digest("SHA-256",
//     new TextEncoder().encode("YOUR NEW PASSWORD"));
//     console.log([...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("")); })()
// ============================================================================
(function () {
  "use strict";

  var PASSWORD = "vT7#qZ2m!wR9pK4x";
  var ACCESS_HASH = "f95d0934eb4aae00b4b40cac45ae529f6d17d6bbc95029e4de31139b512d90aa";

  function sha256Hex(s) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
      var a = new Uint8Array(buf), o = "", i;
      for (i = 0; i < a.length; i++) o += ("0" + a[i].toString(16)).slice(-2);
      return o;
    });
  }

  // Did we already unlock this tab/session?
  var unlocked = false;
  try { unlocked = sessionStorage.getItem("pt_gate_ok") === ACCESS_HASH; } catch (e) {}

  if (unlocked) { loadGame(); return; }

  // Not unlocked — stop the deferred game bundles from executing.
  // (They are <script defer> tags that are already in the DOM; removing them
  // before they run is the reliable way to hold everything back.)
  document.querySelectorAll('script[defer]').forEach(function (s) { s.remove(); });

  function loadGame() {
    ["error_screen.bundle.js", "main.bundle.js"].forEach(function (src) {
      var s = document.createElement("script");
      s.src = src; s.defer = true;
      document.head.appendChild(s);
    });
  }

  function showGate() {
    var css = document.createElement("style");
    css.textContent =
      "#ptgate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;" +
      "background:#0a0a0e;font-family:ui-monospace,monospace}" +
      "#ptgate .card{background:#101014;border:1px solid #2a2a2e;border-radius:12px;padding:32px;width:320px;max-width:90vw;text-align:center}" +
      "#ptgate h1{color:#e10600;font-size:20px;letter-spacing:3px;margin:0 0 6px}" +
      "#ptgate p{color:#888;font-size:12px;margin:0 0 16px}" +
      "#ptgate input{width:100%;background:#0a0a0a;color:#fff;border:1px solid #333;border-radius:6px;" +
      "padding:10px;font:14px ui-monospace,monospace;box-sizing:border-box;text-align:center}" +
      "#ptgate button{width:100%;margin-top:10px;background:#e10600;color:#fff;border:none;border-radius:6px;" +
      "padding:10px;font:bold 13px sans-serif;cursor:pointer}" +
      "#ptgate .err{color:#e10600;font-size:11px;margin-top:10px;min-height:14px}";
    document.head.appendChild(css);

    var g = document.createElement("div");
    g.id = "ptgate";
    g.innerHTML =
      '<div class="card"><h1>POLYTRACK</h1><p>enter the access password</p>' +
      '<input id="ptgate-pw" type="password" autocomplete="off" autofocus />' +
      '<button id="ptgate-go">UNLOCK</button><div class="err" id="ptgate-err"></div></div>';
    document.body.appendChild(g);

    var input = g.querySelector("#ptgate-pw"), errEl = g.querySelector("#ptgate-err");
    function tryUnlock() {
      sha256Hex(input.value).then(function (h) {
        if (h === ACCESS_HASH) {
          try { sessionStorage.setItem("pt_gate_ok", h); } catch (e) {}
          g.remove();
          loadGame();
        } else {
          errEl.textContent = "wrong password";
          input.value = ""; input.focus();
        }
      });
    }
    g.querySelector("#ptgate-go").onclick = tryUnlock;
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    input.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showGate);
  } else {
    showGate();
  }
})();
