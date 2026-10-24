/* Lib – kleine Motion-Bibliothek für die Produktions-Szenen.
 * Jede Szene definiert window.DURATION (Sekunden) und window.renderFrame(t):
 * eine reine Funktion, die den Zustand zur Zeit t setzt. Kein CSS-Transition,
 * keine requestAnimationFrame – der Renderer ruft renderFrame(t) pro Bild auf.
 */
(function () {
  'use strict';
  var BPM = 120;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  var E = {
    linear: function (t) { return t; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuint: function (t) { return 1 - Math.pow(1 - t, 5); },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  };

  /* Fortschritt 0..1 eines Abschnitts, der bei start beginnt und dur dauert. */
  function prog(t, start, dur, ease) {
    var p = clamp((t - start) / (dur || 0.0001), 0, 1);
    return (ease || E.outCubic)(p);
  }

  /* Gedämpfte Feder (f = Frequenz, z = Dämpfung), t in Sekunden ab Start. */
  function spring(t, f, z) {
    if (t <= 0) return 0;
    f = f || 3; z = z == null ? 0.6 : z;
    var w = 2 * Math.PI * f;
    return 1 - Math.exp(-z * w * t) * Math.cos(w * Math.sqrt(Math.max(0.0001, 1 - z * z)) * t);
  }

  /* Zeitpunkt des i-ten Beats (Sekunden). window.BEATS kann eine eigene Liste liefern. */
  function BEAT(i) {
    if (window.BEATS && window.BEATS.length > i) return window.BEATS[i];
    return i * (60 / (window.BPM || BPM));
  }

  /* Zerlegt Text eines Elements in Wörter mit Maske: <span class="w"><span class="wi">Wort</span></span> */
  function splitWords(el) {
    if (!el || el.__split) return el ? el.__split : [];
    var text = el.textContent.trim();
    el.textContent = '';
    var words = [];
    text.split(/\s+/).forEach(function (w, i) {
      var outer = document.createElement('span');
      outer.className = 'w';
      var inner = document.createElement('span');
      inner.className = 'wi';
      inner.textContent = w;
      outer.appendChild(inner);
      el.appendChild(outer);
      if (i < 1e9) el.appendChild(document.createTextNode(' '));
      words.push(inner);
    });
    el.__split = words;
    return words;
  }

  /* Wörter nacheinander einblenden (von unten hoch). opts: stagger, dur, out (Zeitpunkt ausblenden). */
  function reveal(words, t, start, opts) {
    opts = opts || {};
    var stagger = opts.stagger == null ? 0.07 : opts.stagger;
    var dur = opts.dur == null ? 0.45 : opts.dur;
    words.forEach(function (w, i) {
      var p = prog(t, start + i * stagger, dur, E.outQuint);
      var y = (1 - p) * 110;
      var o = p;
      if (opts.out != null && t >= opts.out) {
        var q = prog(t, opts.out + i * stagger * 0.5, 0.3, E.inOutCubic);
        y = -q * 110; o = 1 - q;
      }
      w.style.transform = 'translateY(' + y + '%)';
      w.style.opacity = o;
    });
  }

  /* Zahl hochzählen. fmt(n) formatiert. */
  function countUp(el, t, start, dur, to, fmt) {
    var p = prog(t, start, dur, E.outExpo);
    var n = Math.round(to * p);
    el.textContent = fmt ? fmt(n) : String(n);
  }

  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  function opacity(el, v) { if (el) el.style.opacity = clamp(v, 0, 1); }
  function px(v) { return Math.round(v * 100) / 100 + 'px'; }

  /* Untertitel: window.SUBS = [{start, end, text}] → #subs */
  function subs(t) {
    var box = document.getElementById('subs');
    if (!box) return;
    var list = window.SUBS || [];
    var cur = null;
    for (var i = 0; i < list.length; i++) {
      if (t >= list[i].start && t < list[i].end) { cur = list[i]; break; }
    }
    if (!cur) { box.style.opacity = 0; return; }
    if (box.__text !== cur.text) { box.textContent = cur.text; box.__text = cur.text; }
    var fin = prog(t, cur.start, 0.18, E.outCubic);
    var fout = 1 - prog(t, cur.end - 0.15, 0.15, E.inOutCubic);
    box.style.opacity = Math.min(fin, fout);
    box.style.transform = 'translate(-50%, ' + ((1 - fin) * 14) + 'px)';
  }

  function setPoster(img, url) {
    if (!img) return;
    if (!url) { img.style.visibility = 'hidden'; return; }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
    img.style.visibility = 'visible';
  }

  function frameColor(frameEl, color) {
    if (!frameEl) return;
    var c = (color || 'schwarz').toLowerCase();
    frameEl.classList.toggle('white', c === 'weiß' || c === 'weiss' || c === 'white');
    frameEl.classList.toggle('oak', c === 'eiche' || c === 'oak' || c === 'holz');
  }

  /* Globales Ausblenden am Ende: 1 für t < duration-dur, sonst → 0 */
  function fadeOut(t, duration, dur) {
    dur = dur || 0.4;
    return 1 - prog(t, duration - dur, dur, E.inOutSine);
  }

  window.Lib = {
    BPM: BPM, clamp: clamp, lerp: lerp, E: E, prog: prog, spring: spring, BEAT: BEAT,
    splitWords: splitWords, reveal: reveal, countUp: countUp, show: show, opacity: opacity,
    px: px, subs: subs, setPoster: setPoster, frameColor: frameColor, fadeOut: fadeOut
  };
  window.DATA = window.DATA || {};
})();
