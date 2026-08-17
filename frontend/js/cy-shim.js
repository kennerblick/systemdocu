/*
 * cy-shim.js — a Cytoscape.js backend that mimics the *subset* of the
 * vis-network API this project actually uses (DataSet + Network), so
 * graph.js, filters.js and search.js work unchanged against either engine.
 * Exports: DataSet, Network — same names as the `vis` global, so graph.js
 * can do `const { DataSet, Network } = engine === 'cytoscape' ? cyShim : vis;`
 *
 * Not a general vis-network polyfill — only the calls actually made
 * elsewhere in this codebase are implemented (see graph.js/filters.js/
 * search.js for the exact call sites this mirrors).
 */
'use strict';

const SHAPE_MAP = {
  dot: 'ellipse', ellipse: 'ellipse', box: 'round-rectangle',
  hexagon: 'hexagon', diamond: 'diamond',
};

/** Cytoscape element ids are always strings; this codebase relies on real
 * numbers for plain server/router/etc. node ids (e.g. sidebar.js's
 * `allServers.find(s => s.id === serverId)` uses strict `===`) — vis-network
 * preserves whatever type an id was created with, so restore that here for
 * anything purely numeric. Synthetic ids ('inst_5', 'switch_2', ...) contain
 * non-digit characters and pass through unchanged. */
function origId(id) {
  return /^-?\d+$/.test(id) ? Number(id) : id;
}

/** fCoSE (registered once) is a materially better force-directed layout than
 * Cytoscape's bundled base `cose` for this graph's mix of node sizes/shapes
 * and disconnected components (router groups, isolated environments) — cose
 * neither avoids overlap between differently-sized nodes nor packs
 * disconnected parts sensibly, fcose does both. Requires layout-base.js and
 * cose-base.js loaded before it (see index.html). */
let _fcoseRegistered = false;
function ensureFcose() {
  if (_fcoseRegistered) return;
  if (window.cytoscapeFcose) window.cytoscape.use(window.cytoscapeFcose);
  _fcoseRegistered = true;
}

// vis-network gives short/long-haul edges (e.g. instance -> host vs. a
// generic relation) their own rest length via a per-edge `length`; fcose's
// idealEdgeLength accepts the same kind of per-edge callback (falling back
// to a generic default for edges that don't set one) — without this every
// edge gets pulled to the same length and hosts/instances/switches all
// collapse into one indistinct clump instead of grouping by host.
const FCOSE_LAYOUT_BASE = {
  name: 'fcose', animate: false,
  nodeRepulsion: 6500,
  idealEdgeLength: edge => edge.data('idealLen') || 120,
  edgeElasticity: 0.35, gravity: 0.3, numIter: 2500, tile: true, packComponents: true,
};

/** Cytoscape rejects 8-digit #RRGGBBAA hex (unlike vis/CSS4) — split into a plain
 * hex plus an alpha fraction it accepts as a separate opacity style instead. */
function splitHexAlpha(hex) {
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{8}$/.test(hex)) {
    return { hex: hex.slice(0, 7), alpha: parseInt(hex.slice(7, 9), 16) / 255 };
  }
  return { hex, alpha: 1 };
}

/** Normalises a vis `color` (string | {background,border,highlight} | {color,opacity}) to {bg,border,opacity}. */
function colorOf(c) {
  if (!c) return { bg: '#4b5563', border: '#4b5563', opacity: 1 };
  if (typeof c === 'string') {
    const { hex, alpha } = splitHexAlpha(c);
    return { bg: hex, border: hex, opacity: alpha };
  }
  const { hex: bg, alpha } = splitHexAlpha(c.background || c.color || '#4b5563');
  const { hex: border } = splitHexAlpha(c.border || c.color || bg);
  return { bg, border, opacity: c.opacity != null ? c.opacity : alpha };
}

/** Normalises a vis `arrows` value (''|'to'|{to:{enabled}, from:{enabled}}) to {toArrow, fromArrow}. */
function arrowsOf(arrows) {
  if (!arrows) return { toArrow: false, fromArrow: false };
  if (typeof arrows === 'string') {
    return { toArrow: arrows.includes('to'), fromArrow: arrows.includes('from') };
  }
  return {
    toArrow: !!(arrows.to && arrows.to.enabled !== false),
    fromArrow: !!(arrows.from && arrows.from.enabled),
  };
}

/** Applies a vis-shaped node/edge record's visuals onto a live Cytoscape element. */
function applyVisStyle(ele, rec, isEdge) {
  if (!ele || !ele.length) return;
  ele.style('display', rec.hidden ? 'none' : 'element');
  if (isEdge) {
    const col = colorOf(rec.color);
    const { toArrow, fromArrow } = arrowsOf(rec.arrows);
    ele.style({
      'line-color': col.bg,
      'target-arrow-color': col.bg,
      'source-arrow-color': col.bg,
      'target-arrow-shape': toArrow ? 'triangle' : 'none',
      'source-arrow-shape': fromArrow ? 'triangle' : 'none',
      'line-style': rec.dashes ? 'dashed' : 'solid',
      'line-dash-pattern': Array.isArray(rec.dashes) ? rec.dashes : [6, 4],
      width: rec.width || 1,
      opacity: col.opacity,
      'curve-style': 'bezier',
    });
    ele.data('idealLen', rec.length || null);
  } else {
    const col = colorOf(rec.color);
    const size = (rec.size || 16) * 2;
    ele.style({
      label: rec.label || '',
      shape: SHAPE_MAP[rec.shape] || 'ellipse',
      'background-color': col.bg,
      'background-opacity': col.opacity,
      'border-color': col.border,
      'border-width': rec.borderWidth != null ? rec.borderWidth : 1,
      color: (rec.font && rec.font.color) || '#e0e0e0',
      'font-size': (rec.font && rec.font.size) || 12,
      ...(rec.shape === 'box'
        ? { padding: '8px' }
        : { width: size, height: size }),
    });
    ele.data('title', rec.title || '');
    if (rec.fixed) ele.lock(); else ele.unlock();
  }
}

/**
 * Mimics vis.DataSet: a keyed collection of vis-shaped records, mirrored
 * into live Cytoscape elements once bound to a Network (see _bind).
 */
export class DataSet {
  constructor(initial = []) {
    this._raw = new Map();
    this._cy = null;
    this._kind = null;      // 'node' | 'edge'
    (initial || []).forEach(r => this._raw.set(String(r.id), { ...r }));
  }

  _bind(cy, kind) { this._cy = cy; this._kind = kind; }

  get(id) {
    if (id === undefined) return [...this._raw.values()];
    return this._raw.get(String(id));
  }

  getIds() { return [...this._raw.keys()]; }
  forEach(fn) { this._raw.forEach(fn); }

  add(recs) { return this._each(recs, false); }
  update(recs) { return this._each(recs, true); }

  _each(recs, isUpdate) {
    const arr = Array.isArray(recs) ? recs : [recs];
    let addedUnpositioned = false;
    arr.forEach(r => { if (this._upsert(r, isUpdate)) addedUnpositioned = true; });
    // Deferred: callers like updateInstanceVisibility() add instance nodes
    // and their host-linking edges in separate, back-to-back add() calls —
    // stabilizing immediately after just the nodes would run fcose before
    // the edges that pull each instance toward its own host even exist,
    // scattering them randomly instead. _scheduleAutoStabilize waits a
    // microtask so the whole synchronous batch of add() calls lands first.
    if (addedUnpositioned && this._cy) this._cy._scheduleAutoStabilize && this._cy._scheduleAutoStabilize();
  }

  /** Returns true if a brand-new, unpositioned node was just added (physics settling hint). */
  _upsert(rec, isUpdate) {
    const id = String(rec.id);
    const prev = this._raw.get(id);
    const merged = isUpdate ? { ...(prev || {}), ...rec } : { ...rec };
    this._raw.set(id, merged);
    if (!this._cy) return false;

    let ele = this._cy.getElementById(id);
    let isNew = false;
    if (!ele.length) {
      isNew = true;
      ele = this._cy.add({
        group: this._kind === 'edge' ? 'edges' : 'nodes',
        data: this._kind === 'edge'
          ? { id, source: String(merged.from), target: String(merged.to) }
          : { id },
        position: this._kind === 'node' && merged.x != null ? { x: merged.x, y: merged.y } : undefined,
      });
    } else if (this._kind === 'node' && merged.fixed && merged.x != null) {
      ele.position({ x: merged.x, y: merged.y });
    }
    applyVisStyle(ele, merged, this._kind === 'edge');
    return isNew && this._kind === 'node' && merged.x == null;
  }

  remove(ids) {
    const arr = Array.isArray(ids) ? ids : [ids];
    arr.forEach(id => {
      const sid = String(id);
      this._raw.delete(sid);
      if (this._cy) { const ele = this._cy.getElementById(sid); if (ele.length) ele.remove(); }
    });
  }
}

/**
 * Mimics vis.Network on top of a real Cytoscape instance: same event names/
 * payload shapes, camera and canvas-overlay hooks the rest of the codebase
 * relies on (see graph.js's `beforeDrawing`/`afterDrawing` handlers).
 */
export class Network {
  constructor(container, { nodes, edges }, options = {}) {
    const elements = [];
    nodes.forEach(rec => elements.push({
      group: 'nodes', data: { id: String(rec.id) },
      position: rec.x != null ? { x: rec.x, y: rec.y } : { x: Math.random() * 300, y: Math.random() * 300 },
      // Baked in up front, not applied via .lock() after construction:
      // the layout below (physics mode: fcose with randomize:true) runs as
      // part of this very cytoscape() call, before any later applyVisStyle()
      // call could lock a node — too late to stop it being scattered too.
      locked: !!rec.fixed,
    }));
    edges.forEach(rec => elements.push({
      group: 'edges', data: {
        id: String(rec.id), source: String(rec.from), target: String(rec.to),
        // Same reasoning as `locked` above: fcose's idealEdgeLength callback
        // (see FCOSE_LAYOUT_BASE) reads this per-edge, so it has to be present
        // before the initial layout runs, not set afterwards by applyVisStyle.
        idealLen: rec.length || null,
      },
    }));

    this._physicsMode = !!(options.physics && options.physics.enabled !== false);
    this.physics = { physicsEnabled: true, stabilized: true }; // overlay redraw is always safe here
    if (this._physicsMode) ensureFcose();

    this._cy = window.cytoscape({
      container,
      elements,
      style: [
        { selector: 'node', style: {
          'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap',
          'text-max-width': '140px', 'overlay-opacity': 0,
        } },
        { selector: 'edge', style: { 'overlay-opacity': 0 } },
      ],
      layout: this._physicsMode
        ? { ...FCOSE_LAYOUT_BASE, randomize: true, fit: true }
        : { name: 'preset', fit: false },
      minZoom: 0.04, maxZoom: 5, wheelSensitivity: 1.5,
    });

    nodes._bind(this._cy, 'node');
    edges._bind(this._cy, 'edge');
    nodes.forEach(rec => applyVisStyle(this._cy.getElementById(String(rec.id)), rec, false));
    edges.forEach(rec => applyVisStyle(this._cy.getElementById(String(rec.id)), rec, true));

    this._beforeDrawingCbs = [];
    this._afterDrawingCbs = [];
    this._afterDrawingOnceCbs = [];
    this._stabilizedCbs = [];
    this._stabilizedOnceCbs = [];

    this._overlay = document.createElement('canvas');
    this._overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5';
    container.style.position ||= 'relative';
    container.appendChild(this._overlay);
    this._overlayCtx = this._overlay.getContext('2d');
    this._resizeOverlay();

    // Cytoscape reads the container's size once at construction and never
    // again on its own (unlike a plain <canvas>, it does not observe the DOM)
    // — anything that changes #graph's box afterwards (window resize, but
    // also just opening/closing the sidebar, which resizes #graph via flex)
    // would leave hit-testing and this overlay working off stale dimensions
    // otherwise, e.g. mismatched clicks and overlays.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this._cy.resize();
        this._resizeOverlay();
        this._redrawOverlay();
      });
      this._resizeObserver.observe(container);
    }

    this._cy.on('render pan zoom position drag', () => this._redrawOverlay());
    this._cy.on('tap', evt => {
      if (evt.target === this._cy) this._fire(this._clickCb, { nodes: [] });
    });
    this._cy.on('tap', 'node', evt => this._fire(this._clickCb, { nodes: [origId(evt.target.id())] }));
    this._cy.on('mouseover', 'edge', evt => this._fire(this._hoverEdgeCb, { edge: evt.target.id() }));
    this._cy.on('mouseout', 'edge', () => this._fire(this._blurEdgeCb));
    this._cy.on('zoom', () => this._fire(this._zoomCb));

    // vis-network shows a node's `title` as a native hover tooltip automatically
    // (interaction.hover:true); Cytoscape has no built-in equivalent, so the
    // shim drives the same #edge-tooltip div graph.js already positions on
    // mousemove for edge tooltips — no graph.js changes needed for parity.
    this._cy.on('mouseover', 'node', evt => {
      const title = evt.target.data('title');
      const tt = document.getElementById('edge-tooltip');
      if (!title || !tt) return;
      tt.innerHTML = title;
      tt.style.display = 'block';
    });
    this._cy.on('mouseout', 'node', () => {
      const tt = document.getElementById('edge-tooltip');
      if (tt) tt.style.display = 'none';
    });

    this._autoStabilizeScheduled = false;
    this._cy._scheduleAutoStabilize = () => {
      if (!this._physicsMode || this._autoStabilizeScheduled) return;
      this._autoStabilizeScheduled = true;
      Promise.resolve().then(() => {
        this._autoStabilizeScheduled = false;
        this.stabilize(200);
      });
    };

    if (this._physicsMode) {
      this._cy.one('layoutstop', () => this._emitStabilized());
    } else {
      setTimeout(() => this._emitStabilized(), 0);
    }
    this._redrawOverlay();
  }

  _fire(cb, payload) { if (cb) cb(payload); this._redrawOverlay(); }

  _emitStabilized() {
    this._stabilizedCbs.forEach(cb => cb());
    const once = this._stabilizedOnceCbs; this._stabilizedOnceCbs = [];
    once.forEach(cb => cb());
  }

  on(event, cb) {
    if (event === 'click') this._clickCb = cb;
    else if (event === 'zoom') this._zoomCb = cb;
    else if (event === 'stabilized') this._stabilizedCbs.push(cb);
    else if (event === 'hoverEdge') this._hoverEdgeCb = cb;
    else if (event === 'blurEdge') this._blurEdgeCb = cb;
    else if (event === 'beforeDrawing') this._beforeDrawingCbs.push(cb);
    else if (event === 'afterDrawing') this._afterDrawingCbs.push(cb);
  }

  once(event, cb) {
    if (event === 'stabilized') this._stabilizedOnceCbs.push(cb);
    else if (event === 'afterDrawing') this._afterDrawingOnceCbs.push(cb);
    else this.on(event, cb);
  }

  fit({ nodes: ids, animation } = {}) {
    const coll = ids && ids.length
      ? this._cy.collection(ids.map(id => this._cy.getElementById(String(id))))
      : this._cy.elements(':visible');
    if (!coll.length) return;
    if (animation) this._cy.animate({ fit: { eles: coll, padding: 40 } }, { duration: animation.duration || 300 });
    else this._cy.fit(coll, 40);
  }

  moveTo(opts = {}) {
    const zoom = opts.scale != null ? opts.scale : this._cy.zoom();
    const pan = opts.position ? this._panForCenter(opts.position, zoom) : this._cy.pan();
    if (opts.animation) this._cy.animate({ zoom, pan }, { duration: opts.animation.duration || 400 });
    else { this._cy.zoom(zoom); this._cy.pan(pan); }
  }

  _panForCenter(pos, zoom) {
    return { x: this._cy.width() / 2 - pos.x * zoom, y: this._cy.height() / 2 - pos.y * zoom };
  }

  getScale() { return this._cy.zoom(); }

  getPosition(id) {
    const ele = this._cy.getElementById(String(id));
    if (!ele.length) throw new Error('cy-shim: unknown node ' + id);
    const p = ele.position();
    return { x: p.x, y: p.y };
  }

  stabilize(/* iterations hint, unused: fcose runs to its own completion */) {
    if (!this._physicsMode) return;
    const layout = this._cy.elements(':visible').layout({
      ...FCOSE_LAYOUT_BASE, randomize: false, fit: false,
    });
    layout.one('layoutstop', () => this._emitStabilized());
    layout.run();
  }

  redraw() { this._redrawOverlay(); }

  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
    this._cy.destroy();
  }

  // Read/write proxy for the one place (filters.js) that reaches into vis'
  // internal simulation body to reposition a node without a full DataSet
  // update round-trip.
  get body() {
    const cy = this._cy;
    return {
      nodes: new Proxy({}, {
        get(_, id) {
          const ele = cy.getElementById(String(id));
          if (!ele.length) return undefined;
          return {
            get x() { return ele.position('x'); },
            set x(v) { ele.position('x', v); },
            get y() { return ele.position('y'); },
            set y(v) { ele.position('y', v); },
          };
        },
      }),
    };
  }

  _resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const w = this._cy.width(), h = this._cy.height();
    this._overlay.width = w * dpr;
    this._overlay.height = h * dpr;
    this._overlay.style.width = w + 'px';
    this._overlay.style.height = h + 'px';
  }

  _redrawOverlay() {
    if (!this._overlayCtx) return;
    const w = this._cy.width(), h = this._cy.height();
    if (this._overlay.style.width !== w + 'px' || this._overlay.style.height !== h + 'px') this._resizeOverlay();
    const ctx = this._overlayCtx;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pan = this._cy.pan(), zoom = this._cy.zoom();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    this._beforeDrawingCbs.forEach(cb => cb(ctx));
    this._afterDrawingCbs.forEach(cb => cb(ctx));
    if (this._afterDrawingOnceCbs.length) {
      const cbs = this._afterDrawingOnceCbs; this._afterDrawingOnceCbs = [];
      cbs.forEach(cb => cb(ctx));
    }
    ctx.restore();
  }
}
