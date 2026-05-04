/*
 * search.js — search index, input handling, dropdown rendering, and node-blink animation.
 * Exports: onSearchInput, onSearchKey, stopBlink, initSearch.
 */
'use strict';

import {
  allServers,
  network, nodes,
  _searchResults, _searchIdx,
  setSearchState, setSearchIdx,
  _blinkTimer, _blinkNodeId, _blinkOrigColor,
  setBlinkState,
  showingInstances,
  INST_ZOOM_THRESHOLD,
  layoutMode,
} from './state.js';

import { escHtml } from './utils.js';
import { updateInstanceVisibility } from './graph.js';

/** Builds a flat search index from all servers and their instances. */
function _buildSearchIndex() {
  const idx = [];
  allServers.forEach(srv => {
    const ips = (srv.ip || '').split(',').map(s => s.trim()).filter(Boolean);
    idx.push({ nodeId: srv.id, label: srv.hostname, sub: ips.join(', '), ips, type: 'server' });
    (srv.services || []).forEach(svc => {
      (svc.instances || []).forEach(inst => {
        idx.push({ nodeId: 'inst_' + inst.id, label: inst.name, sub: srv.hostname, ips: [], type: 'instance' });
      });
    });
  });
  return idx;
}

/**
 * Handles search input changes — filters the index and re-renders the dropdown.
 */
export function onSearchInput(q) {
  const dd = document.getElementById('search-dd');
  q = q.trim().toLowerCase();
  if (!q) { dd.style.display = 'none'; setSearchState([], -1); return; }
  const results = _buildSearchIndex().filter(item =>
    item.label.toLowerCase().includes(q) ||
    item.sub.toLowerCase().includes(q) ||
    item.ips.some(ip => ip.includes(q))
  ).slice(0, 20);
  setSearchState(results, -1);
  _renderSearchDd();
}

/** Renders the search results dropdown from the current _searchResults array. */
function _renderSearchDd() {
  const dd = document.getElementById('search-dd');
  if (!_searchResults.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = '';
  _searchResults.forEach((item, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:0.82rem;display:flex;flex-direction:column;gap:1px';
    const icon = item.type === 'server'
      ? '<i class="fa-solid fa-server" style="color:#60a5fa;width:12px"></i>'
      : '<i class="fa-solid fa-cube" style="color:#a78bfa;width:12px"></i>';
    row.innerHTML = '<span style="color:#e0e0e0;display:flex;align-items:center;gap:6px">' + icon + escHtml(item.label) + '</span>' +
      (item.sub ? '<span style="font-size:0.72rem;color:#6b7280;padding-left:18px">' + escHtml(item.sub) + '</span>' : '');
    row.onmouseenter = () => { setSearchIdx(i); _highlightSearchDd(); };
    row.onmouseleave = () => { setSearchIdx(-1); _highlightSearchDd(); };
    row.onclick = () => _selectSearchResult(item);
    dd.appendChild(row);
  });
  dd.style.display = 'block';
}

/** Highlights the currently active search result row. */
function _highlightSearchDd() {
  const dd = document.getElementById('search-dd');
  [...dd.children].forEach((row, i) => { row.style.background = i === _searchIdx ? '#334155' : ''; });
}

/**
 * Handles keyboard navigation (arrows, Enter, Escape) in the search input.
 */
export function onSearchKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setSearchIdx(Math.min(_searchIdx + 1, _searchResults.length - 1));
    _highlightSearchDd();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setSearchIdx(Math.max(_searchIdx - 1, 0));
    _highlightSearchDd();
  } else if (e.key === 'Enter' && _searchResults.length) {
    e.preventDefault();
    _selectSearchResult(_searchResults[Math.max(_searchIdx, 0)]);
  } else if (e.key === 'Escape') {
    document.getElementById('search-dd').style.display = 'none';
  }
}

/** Fills the search input with the selected result label and zooms to the node. */
function _selectSearchResult(item) {
  document.getElementById('search-input').value = item.label;
  document.getElementById('search-dd').style.display = 'none';
  _zoomToNode(item.nodeId);
}

/** Zooms to a node, waiting for instances to become visible if needed. */
function _zoomToNode(nodeId) {
  if (!network) return;
  stopBlink();
  if (layoutMode === 'physics' && !showingInstances) {
    // Jump past threshold instantly so instances are added to the DataSet.
    network.moveTo({ scale: INST_ZOOM_THRESHOLD + 0.15 });
    updateInstanceVisibility(network.getScale());
    // Wait for physics to settle, then focus. Fallback after 1.5 s.
    let done = false;
    const go = () => { if (done) return; done = true; _focusNode(nodeId); };
    network.once('stabilized', go);
    setTimeout(go, 1500);
  } else {
    _focusNode(nodeId);
  }
}

/** Focuses the camera on a node using its current graph position. */
function _focusNode(nodeId) {
  if (!network) return;
  let pos;
  try { pos = network.getPosition(nodeId); } catch (_) { return; }
  if (!pos) return;
  network.moveTo({
    position: { x: pos.x, y: pos.y },
    scale: 1.6,
    animation: { duration: 500, easingFunction: 'easeInOutQuad' },
  });
  _startBlink(nodeId);
}

/** Starts a yellow blink animation on the given node to highlight it. */
function _startBlink(nodeId) {
  stopBlink();
  const node = nodes.get(nodeId);
  if (!node) return;
  const origColor = node.color;
  let bright = true;
  const timer = setInterval(() => {
    if (!nodes.get(nodeId)) { stopBlink(); return; }
    nodes.update({ id: nodeId, color: bright
      ? { background: '#facc15', border: '#fbbf24', highlight: { background: '#fde68a', border: '#fff' } }
      : origColor });
    bright = !bright;
  }, 380);
  setBlinkState(timer, nodeId, origColor);
}

/**
 * Stops any active blink animation and restores the node's original colour.
 */
export function stopBlink() {
  if (_blinkTimer) { clearInterval(_blinkTimer); }
  if (_blinkNodeId !== null) {
    const node = nodes ? nodes.get(_blinkNodeId) : null;
    if (node && _blinkOrigColor) nodes.update({ id: _blinkNodeId, color: _blinkOrigColor });
  }
  setBlinkState(null, null, null);
}

/**
 * Wires up search input event listeners.
 */
export function initSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', () => onSearchInput(input.value));
  input.addEventListener('keydown', onSearchKey);
  input.addEventListener('focus', () => onSearchInput(input.value));

  // Close dropdown when clicking outside the search wrapper
  document.addEventListener('click', e => {
    if (!document.getElementById('search-wrap').contains(e.target)) {
      document.getElementById('search-dd').style.display = 'none';
    }
  });
}
