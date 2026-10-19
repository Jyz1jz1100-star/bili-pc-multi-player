/* bili-multiplayer shim -- prepended INSIDE the launcher's wrapper
   (function(module, exports, require, __dirname, __filename){ <THIS> ...bundle... })

   The app's own obfuscated code stays byte-identical; we only add runtime hooks:
   1) "window/openPlayerWindow" creates a NEW player window when the request is a genuine
      user action (mouse/keyboard input in a window within the last 2s), the existing
      singleton is already showing a different video, and no window was just created.
      Hover-preview / programmatic requests keep the original "reuse one window" behaviour.
   2) closing a player window hides THAT window instead of the newest one.
*/
(function () {
  var log;
  try {
    var fs = require('fs'), path = require('path'), os = require('os');
    var logPath = path.join(os.tmpdir(), 'bili-multiplayer-shim.log');
    log = function (m) { try { fs.appendFileSync(logPath, new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} };
  } catch (e) { log = function () {}; }

  try {
    var E = require('electron');
    var BW = E.BrowserWindow, ipcMain = E.ipcMain, app = E.app;
    var proto = BW.prototype;
    var isPlayer = function (w) {
      try { return !!(w && !w.isDestroyed() && w.webContents && (w.webContents.getURL() || '').indexOf('/player.html') >= 0); }
      catch (e) { return false; }
    };
    var anyPlayer = function () { return BW.getAllWindows().filter(isPlayer); };


    /* ---- which video does an open request refer to ---- */
    var videoKey = function (p) {
      if (!p || typeof p !== 'object') return null;
      if (p.mediaList) return 'ml:' + (p.mediaList.bizType || '') + ':' + (p.mediaList.bizId || '') + ':' + (p.mediaList.bizTitle || '');
      if (p.type === 'ogv') return 'ogv:' + (p.epid || '') + ':' + (p.seasonId || '');
      if (p.bvid) return 'bv:' + p.bvid;
      if (p.aid) return 'av:' + p.aid;
      return null;
    };
    /* 同一个视频也允许开多个窗口：只对"同一次点击重复发出的同一个请求"做去重
       （同一个 key 且在 ~1.2s 内），不再因为"该视频已在某个窗口播放"而拒绝开窗。 */
    var lastCreatedAt = 0;
    var lastCreatedKey = null;

    /* ---------------- 1. one window per user-requested video ---------------- */
    // Extra player windows are not in the app's singleton registry, so the IPC handlers that
    // resolve "the window that sent this" throw for them (log spam: "CallNative error, API:
    // window/playerWindowMouseEnter|N"). Swallow those specific failures.
    var senderChannels = {
      'window/playerWindowMouseEnter': 1,
      'window/playerWindowMouseLeave': 1,
      'window/checkPlayerWindowStatus': 1,
      'window/setPlayerVideoSize': 1,
      'window/setMiniPlayerBtnsVisible': 1,
      'window/mainWindowMouseEnter': 1,
      'window/setMainVideoSize': 1,
      'window/pinPlayerWindow': 1,
      'window/unpinPlayerWindow': 1,
      'window/stretchPlayerWindow': 1
    };
    var guardChannel = function (channel, fn) {
      if (!senderChannels[channel]) return fn;
      return function () {
        try {
          var r = fn.apply(this, arguments);
          if (r && typeof r.then === 'function') {
            return r.catch(function (e) { log('ipc error swallowed [' + channel + ']: ' + (e && (e.message || e))); return null; });
          }
          return r;
        } catch (e) {
          log('ipc error swallowed [' + channel + ']: ' + (e && (e.message || e)));
          return null;
        }
      };
    };

    var origHandle = ipcMain.handle;
    ipcMain.handle = function (channel, listener) {
      if (channel === 'window/openPlayerWindow' && typeof listener === 'function') {
        var wrapped = function () {
          var now = Date.now();
          var wins = anyPlayer();
          var params = null;
          try { params = arguments[1]; } catch (e) {}
          var visible = wins.filter(function (w) { try { return w.isVisible(); } catch (e) { return false; } });
          var key = videoKey(params);
          var marked = !params || params.__realOpen !== false;   // unmarked requests are treated as real (menu/tray/legacy)
          var duplicate = !!(key && key === lastCreatedKey && (now - lastCreatedAt) < 1200);
          var force = !!(visible.length && key && marked && !duplicate);

          if (!force) {
            log('openPlayerWindow: reuse (key=' + key + ' marked=' + marked + ' duplicate=' + duplicate + ' visible=' + visible.length + ')');
            return listener.apply(this, arguments);
          }

          var restores = wins.map(function (w) {
            var own = Object.getOwnPropertyDescriptor(w, 'isDestroyed');
            try { w.isDestroyed = function () { return true; }; } catch (e) {}
            return function () {
              try { if (own) { Object.defineProperty(w, 'isDestroyed', own); } else { delete w.isDestroyed; } } catch (e) {}
            };
          });
          var restored = false;
          function restore() {
            if (restored) return;
            restored = true;
            restores.forEach(function (r) { try { r(); } catch (e) {} });
            log('fake isDestroyed restored after ' + (Date.now() - t0) + 'ms; player windows=' + anyPlayer().length);
          }
          var t0 = Date.now();
          lastCreatedAt = now;
          lastCreatedKey = key;
          log('openPlayerWindow: NEW window (existing=' + wins.length + ' key=' + key + ')');
          var timer = setTimeout(restore, 6000);
          try {
            app.once('browser-window-created', function () {
              setTimeout(function () { clearTimeout(timer); restore(); }, 500);
            });
          } catch (e) {}
          try { return listener.apply(this, arguments); }
          finally { if (!wins.length) restore(); }
        };
        return origHandle.call(ipcMain, channel, wrapped);
      }
      if (typeof listener === 'function' && senderChannels[channel]) {
        return origHandle.call(ipcMain, channel, guardChannel(channel, listener));
      }
      return origHandle.apply(ipcMain, arguments);
    };

    /* ---------------- 2. close the window that was actually closed ---------------- */
    var closingWin = null;
    var quitting = false;
    app.on('before-quit', function () { quitting = true; });
    app.on('will-quit', function () { quitting = true; });

    var origHide = proto.hide;
    proto.hide = function () {
      if (closingWin && this !== closingWin) { log('hide() redirected away from the window being closed'); return; }
      return origHide.apply(this, arguments);
    };

    function closeGuard(e) {
      var w = this;
      try {
        if (quitting) { log('close passed through (quitting)'); return; }
        if (!isPlayer(w)) return;
        if (typeof e.preventDefault === 'function') e.preventDefault();
        closingWin = w;
        setTimeout(function () { closingWin = null; }, 0);
        try { w.hide(); } catch (err) {}
        log('player window close intercepted -> hidden');
      } catch (err) { log('closeGuard error: ' + (err && err.stack || err)); }
    }

    ['on', 'once', 'addListener'].forEach(function (m) {
      var orig = proto[m];
      if (typeof orig !== 'function') return;
      proto[m] = function (ev) {
        try {
          if (ev === 'close' && this && !this.__biliCloseGuarded) {
            this.__biliCloseGuarded = true;
            orig.call(this, 'close', closeGuard);
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
    });

    log('shim active (electron ' + process.versions.electron + ')');
  } catch (e) {
    log('SHIM ERROR: ' + (e && e.stack || e));
  }
})();
