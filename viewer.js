/* Parallel PDF viewer: view several PDFs side by side, pick how many panes. */
(function () {
  "use strict";
  var cfg = window.PARALLEL || {};
  var docs = (cfg.docs || []).map(function (d) { return { title: d.title || d.src, src: d.src }; });
  var KEY = "pv:" + (cfg.key || "default");
  var MAX_PANES = 6;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var root = document.getElementById("parallel");

  if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    // pdf.worker.min.js is also loaded on the page, so pdf.js can fall back to the main thread.
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ n: state.n, layout: state.layout, sync: state.sync,
        panes: panes.map(function (p) { return p.docIdx; }) }));
    } catch (e) {}
  }
  var saved = load();
  var state = {
    n: Math.max(1, Math.min(saved.n || cfg.panes || Math.min(docs.length || 1, 3), MAX_PANES)),
    layout: saved.layout || cfg.layout || "side",
    sync: !!saved.sync
  };
  var panes = [];
  var active = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- documents ---------- */
  function openDoc(d) {
    if (!d.promise) {
      var src = d.data ? { data: d.data } : { url: d.src };
      d.promise = pdfjsLib.getDocument(src).promise.then(function (pdf) {
        d.pdf = pdf;
        var sizes = [], chain = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (n) {
            chain = chain.then(function () { return pdf.getPage(n); }).then(function (pg) {
              var v = pg.getViewport({ scale: 1 });
              sizes[n - 1] = { w: v.width, h: v.height };
            });
          })(i);
        }
        return chain.then(function () { d.sizes = sizes; return d; });
      });
    }
    return d.promise;
  }

  /* ---------- pane ---------- */
  function Pane(i) {
    this.i = i;
    this.docIdx = -1;
    this.zoom = "fit";
    this.scale = 1;
    this.pageEls = [];
    this.tasks = {};
    this.lastTop = 0;
    this.build();
  }
  Pane.prototype.build = function () {
    var self = this;
    this.node = el("section", "pv-pane");
    this.node.addEventListener("pointerdown", function () { setActive(self.i); });
    var head = el("div", "pv-phead");
    this.sel = el("select");
    this.sel.setAttribute("aria-label", "Document in pane " + (this.i + 1));
    this.sel.addEventListener("change", function () { self.setDoc(+self.sel.value); save(); });
    this.prev = el("button", "pv-ibtn", "‹"); this.prev.title = "Previous page";
    this.next = el("button", "pv-ibtn", "›"); this.next.title = "Next page";
    this.pnum = el("span", "pv-pnum");
    this.pinput = el("input"); this.pinput.type = "text"; this.pinput.inputMode = "numeric"; this.pinput.setAttribute("aria-label", "Page");
    this.ptotal = el("span", null, " / –");
    this.pnum.append(this.pinput, this.ptotal);
    var zout = el("button", "pv-ibtn", "−"); zout.title = "Zoom out";
    var zfit = el("button", "pv-ibtn", "Fit"); zfit.title = "Fit width";
    var zin = el("button", "pv-ibtn", "+"); zin.title = "Zoom in";
    this.prev.onclick = function () { self.goto(self.current() - 1); };
    this.next.onclick = function () { self.goto(self.current() + 1); };
    this.pinput.addEventListener("change", function () { self.goto(parseInt(self.pinput.value, 10) || 1); });
    zout.onclick = function () { self.setZoom(Math.max(0.25, self.scale / 1.2)); };
    zin.onclick = function () { self.setZoom(Math.min(5, self.scale * 1.2)); };
    zfit.onclick = function () { self.setZoom("fit"); };
    head.append(this.sel, this.prev, this.pnum, this.next, zout, zfit, zin);
    this.scroller = el("div", "pv-scroll");
    this.scroller.addEventListener("scroll", function () { self.onScroll(); }, { passive: true });
    this.node.append(head, this.scroller);
    this.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var n = +e.target.dataset.page;
        if (e.isIntersecting) self.renderPage(n); else self.releasePage(n);
      });
    }, { root: this.scroller, rootMargin: "120% 0px" });
    var t;
    this.ro = new ResizeObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { if (self.zoom === "fit") self.layout(); }, 120);
    });
    this.ro.observe(this.scroller);
    this.fillSelect();
  };
  Pane.prototype.fillSelect = function () {
    this.sel.textContent = "";
    if (!docs.length) { this.sel.append(el("option", null, "No PDFs yet")); return; }
    var self = this;
    docs.forEach(function (d, k) {
      var o = el("option", null, d.title); o.value = k;
      if (k === self.docIdx) o.selected = true;
      self.sel.append(o);
    });
  };
  Pane.prototype.setDoc = function (k) {
    if (k === this.docIdx && this.doc) return;
    this.docIdx = k;
    this.doc = null;
    this.clear();
    if (!docs[k]) { this.scroller.append(el("div", "pv-empty", "Use Add PDF or drop PDFs here.")); return; }
    var self = this;
    this.sel.value = k;
    this.scroller.append(el("div", "pv-empty", "Loading " + docs[k].title + "…"));
    openDoc(docs[k]).then(function (d) {
      if (self.docIdx !== k) return;
      self.doc = d;
      self.ptotal.textContent = " / " + d.pdf.numPages;
      self.layout(0);
    }).catch(function (err) {
      if (self.docIdx !== k) return;
      self.clear();
      self.scroller.append(el("div", "pv-err", "Couldn't open " + docs[k].title + ": " + (err && err.message || err)));
    });
  };
  Pane.prototype.clear = function () {
    var self = this;
    Object.keys(this.tasks).forEach(function (n) { try { self.tasks[n].cancel(); } catch (e) {} });
    this.tasks = {};
    this.pageEls.forEach(function (p) { self.io.unobserve(p); });
    this.pageEls = [];
    this.scroller.textContent = "";
    this.ptotal.textContent = " / –";
    this.pinput.value = "";
  };
  Pane.prototype.fitScale = function () {
    var maxW = 0;
    this.doc.sizes.forEach(function (s) { if (s.w > maxW) maxW = s.w; });
    var avail = this.scroller.clientWidth - 24;
    return Math.max(0.2, avail / (maxW || 612));
  };
  Pane.prototype.anchor = function () {
    var cur = this.current() - 1, p = this.pageEls[cur];
    if (!p) return 0;
    return cur + Math.max(0, Math.min(1, (this.scroller.scrollTop - p.offsetTop) / p.offsetHeight));
  };
  Pane.prototype.layout = function (anchor) {
    if (!this.doc) return;
    if (anchor == null) anchor = this.anchor();
    var self = this;
    this.scale = this.zoom === "fit" ? this.fitScale() : this.zoom;
    Object.keys(this.tasks).forEach(function (n) { try { self.tasks[n].cancel(); } catch (e) {} });
    this.tasks = {};
    this.pageEls.forEach(function (p) { self.io.unobserve(p); });
    this.scroller.textContent = "";
    this.pageEls = this.doc.sizes.map(function (s, k) {
      var p = el("div", "pv-page");
      p.dataset.page = k + 1;
      p.style.width = Math.floor(s.w * self.scale) + "px";
      p.style.height = Math.floor(s.h * self.scale) + "px";
      self.scroller.append(p);
      return p;
    });
    var a = Math.floor(anchor), f = anchor - a, target = this.pageEls[Math.min(a, this.pageEls.length - 1)];
    this.lastTop = this.scroller.scrollTop = target ? target.offsetTop + f * target.offsetHeight : 0;
    this.pageEls.forEach(function (p) { self.io.observe(p); });
    this.updateNum();
  };
  Pane.prototype.setZoom = function (z) { this.zoom = z; this.layout(); };
  Pane.prototype.renderPage = function (n) {
    var p = this.pageEls[n - 1], self = this, scale = this.scale, pdf = this.doc && this.doc.pdf;
    if (!p || !pdf || p.dataset.scale == String(scale) || this.tasks[n]) return;
    pdf.getPage(n).then(function (page) {
      if (self.pageEls[n - 1] !== p || self.scale !== scale) return;
      var vp = page.getViewport({ scale: scale * DPR });
      var canvas = el("canvas");
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      var task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
      self.tasks[n] = task;
      return task.promise.then(function () {
        delete self.tasks[n];
        if (self.pageEls[n - 1] !== p) return;
        p.textContent = "";
        p.append(canvas);
        p.dataset.scale = scale;
        var tl = el("div", "textLayer");
        tl.style.setProperty("--scale-factor", scale);
        p.append(tl);
        return page.getTextContent().then(function (tc) {
          pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: page.getViewport({ scale: scale }) });
        });
      });
    }).catch(function (e) {
      delete self.tasks[n];
      if (!e || e.name !== "RenderingCancelledException") console.warn("render failed", n, e);
    });
  };
  Pane.prototype.releasePage = function (n) {
    var p = this.pageEls[n - 1];
    if (this.tasks[n]) { try { this.tasks[n].cancel(); } catch (e) {} delete this.tasks[n]; }
    if (p && p.dataset.scale) { p.textContent = ""; delete p.dataset.scale; }
  };
  Pane.prototype.current = function () {
    var top = this.scroller.scrollTop + this.scroller.clientHeight * 0.3, list = this.pageEls;
    for (var k = 0; k < list.length; k++) {
      if (list[k].offsetTop + list[k].offsetHeight > top) return k + 1;
    }
    return list.length || 1;
  };
  Pane.prototype.goto = function (n) {
    if (!this.pageEls.length) return;
    n = Math.max(1, Math.min(n, this.pageEls.length));
    this.scroller.scrollTop = this.pageEls[n - 1].offsetTop - 6;
  };
  Pane.prototype.updateNum = function () {
    if (document.activeElement !== this.pinput) this.pinput.value = this.pageEls.length ? this.current() : "";
  };
  Pane.prototype.onScroll = function () {
    var top = this.scroller.scrollTop, delta = top - this.lastTop;
    this.lastTop = top;
    this.updateNum();
    if (this.muted) { this.muted = false; return; }
    if (!state.sync || !delta) return;
    var self = this;
    panes.forEach(function (o) {
      if (o === self || !o.doc) return;
      o.muted = true;
      o.scroller.scrollTop += delta * (o.scale / self.scale);
    });
  };

  /* ---------- shell ---------- */
  var bar = el("header", "pv-bar");
  var title = el("div", "pv-title", cfg.title || "PDFs side by side");
  var count = el("small"); title.append(count);
  var gCount = el("div", "pv-group"), segN = el("div", "pv-seg");
  segN.setAttribute("role", "group"); segN.setAttribute("aria-label", "PDFs at once");
  gCount.append(el("span", "pv-label", "At once"), segN);
  var gLayout = el("div", "pv-group pv-layout"), segL = el("div", "pv-seg");
  [["side", "Side by side"], ["grid", "Grid"]].forEach(function (o) {
    var b = el("button", null, o[1]); b.dataset.layout = o[0];
    b.onclick = function () { state.layout = o[0]; applyLayout(); save(); };
    segL.append(b);
  });
  gLayout.append(el("span", "pv-label", "Layout"), segL);
  var syncBtn = el("button", "pv-btn", "Sync scroll");
  syncBtn.title = "Scroll every pane together";
  syncBtn.onclick = function () { state.sync = !state.sync; syncBtn.setAttribute("aria-pressed", state.sync); save(); };
  var addBtn = el("button", "pv-btn", "Add PDF");
  var file = el("input", "pv-file"); file.type = "file"; file.accept = "application/pdf,.pdf"; file.multiple = true;
  addBtn.onclick = function () { file.click(); };
  file.onchange = function () { addFiles(file.files); file.value = ""; };
  bar.append(title, gCount, gLayout, syncBtn, addBtn, file);
  var grid = el("main", "pv-panes");
  var drop = el("div", "pv-drop", "Drop PDFs to add them");
  root.textContent = "";
  root.className = "pv";
  root.append(bar, grid, drop);

  function maxPanes() { return Math.min(MAX_PANES, Math.max(4, docs.length)); }
  function buildCountButtons() {
    segN.textContent = "";
    for (var k = 1; k <= maxPanes(); k++) {
      (function (k) {
        var b = el("button", null, String(k));
        b.title = k === 1 ? "Show 1 PDF" : "Show " + k + " PDFs at once";
        b.onclick = function () { setCount(k); };
        segN.append(b);
      })(k);
    }
    count.textContent = docs.length + (docs.length === 1 ? " PDF" : " PDFs");
  }
  function setActive(k) {
    active = k;
    panes.forEach(function (p) { p.node.classList.toggle("active", p.i === k && panes.length > 1); });
  }
  function nextUnused() {
    var used = panes.map(function (p) { return p.docIdx; });
    for (var k = 0; k < docs.length; k++) if (used.indexOf(k) < 0) return k;
    return docs.length ? panes.length % docs.length : -1;
  }
  function setCount(n) {
    state.n = Math.max(1, Math.min(n, maxPanes()));
    while (panes.length > state.n) { var p = panes.pop(); p.clear(); p.io.disconnect(); p.ro.disconnect(); p.node.remove(); }
    while (panes.length < state.n) {
      var q = new Pane(panes.length);
      var want = saved.panes && saved.panes[q.i];
      var idx = (want != null && docs[want] && panes.every(function (o) { return o.docIdx !== want; })) ? want : nextUnused();
      panes.push(q);
      grid.append(q.node);
      q.setDoc(idx);
    }
    if (active >= panes.length) active = 0;
    applyLayout();
    setActive(active);
    save();
  }
  function applyLayout() {
    var n = state.n, cols = n, rows = 1;
    if (state.layout === "grid" && n > 2) { cols = Math.ceil(Math.sqrt(n)); rows = Math.ceil(n / cols); }
    grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    grid.style.gridTemplateRows = "repeat(" + rows + ", minmax(0, 1fr))";
    Array.prototype.forEach.call(segN.children, function (b, k) { b.setAttribute("aria-pressed", k + 1 === n); });
    Array.prototype.forEach.call(segL.children, function (b) { b.setAttribute("aria-pressed", b.dataset.layout === state.layout); });
    gLayout.style.display = n > 2 ? "" : "none";
  }
  function addFiles(list) {
    var added = [];
    Array.prototype.forEach.call(list || [], function (f) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return;
      var d = { title: f.name.replace(/\.pdf$/i, ""), src: f.name };
      d.dataPromise = f.arrayBuffer().then(function (buf) { d.data = new Uint8Array(buf); });
      docs.push(d);
      added.push(docs.length - 1);
    });
    if (!added.length) return;
    Promise.all(added.map(function (k) { return docs[k].dataPromise; })).then(function () {
      buildCountButtons();
      panes.forEach(function (p) { p.fillSelect(); });
      var target = panes[active];
      if (target) target.setDoc(added[0]);
      added.slice(1).forEach(function (k) {
        var free = panes.filter(function (p) { return p.docIdx < 0 || !docs[p.docIdx]; })[0];
        if (free) free.setDoc(k);
      });
      applyLayout();
      save();
    });
  }

  var depth = 0;
  window.addEventListener("dragenter", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) { depth++; drop.classList.add("on"); } });
  window.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("on"); });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); depth = 0; drop.classList.remove("on"); addFiles(e.dataTransfer && e.dataTransfer.files); });

  syncBtn.setAttribute("aria-pressed", state.sync);
  buildCountButtons();
  setCount(state.n);
})();
