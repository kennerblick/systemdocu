/*
 * utils.js — shared helper utilities used across multiple modules.
 * Exports: escHtml, buildTooltip, buildInstServerMap, makeInstDropdownBtn, checkZabbixStatus, nextColor.
 */
'use strict';

import {
  allServers, allClusters, allRouters,
  SVC_COLORS, AUTO_COLORS,
} from './state.js';

/**
 * Returns the display label for a server: common_name if set, otherwise hostname.
 */
export function displayName(server) {
  return (server.common_name && server.common_name.trim()) || server.hostname;
}

/**
 * Escapes HTML special characters to prevent XSS in innerHTML assignments.
 */
export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds a small DOM tooltip for a vis-network node `title`. vis-network
 * ≥9.1.7 renders node titles via `textContent` rather than `innerHTML` (an
 * XSS-hardening change upstream), so the old approach of joining escaped
 * strings with literal '<br>' no longer produces line breaks — the raw tags
 * show up as text instead. Every node tooltip must therefore be built as an
 * actual DOM element, which vis-network's popup appends as-is (each entry
 * becomes its own line, no HTML needed).
 *
 * `rows` is a flat list of strings (falsy entries — null/undefined/'' — are
 * skipped, so callers can inline conditionals) or {text, bold, muted}
 * objects for emphasis/de-emphasis.
 *
 * The returned element also carries a plain-text `dataset.sig`, used by
 * graph.js's change-detection signature: a freshly built DOM element always
 * stringifies to the same generic "[object HTMLDivElement]" regardless of
 * its actual content, so without this the live graph would never notice a
 * tooltip's content changed (e.g. an IP added to a server) unless some other
 * field changed at the same time.
 */
export function buildTooltip(rows) {
  const el = document.createElement('div');
  el.className = 'graph-tooltip';
  const sig = [];
  rows.filter(row => row !== null && row !== undefined && row !== false && row !== '').forEach(row => {
    // typeof row === 'object' (not just `row.bold` truthiness) guards against
    // the legacy String.prototype.bold()/italics() wrapper methods — a plain
    // string row's `.bold` is that *function*, which is truthy, so every row
    // would render bold without this check.
    const isObj = row !== null && typeof row === 'object';
    const text = isObj ? row.text : row;
    const line = document.createElement('div');
    line.textContent = text;
    if (isObj && row.bold) line.style.fontWeight = '700';
    if (isObj && row.muted) line.style.opacity = '0.7';
    el.appendChild(line);
    sig.push(text);
  });
  el.dataset.sig = sig.join('');
  return el;
}

/**
 * Builds a flat map from instance ID to {serverId|clusterId, name, svcType, ownServices}.
 */
export function buildInstServerMap() {
  const map = {};
  allServers.forEach(s => {
    (s.services || []).forEach(svc => {
      (svc.instances || []).forEach(inst => {
        map[inst.id] = {
          serverId: s.id, name: inst.name, svcType: svc.type,
          ownServices: inst.own_services || [],
        };
      });
    });
  });
  allClusters.forEach(cl => {
    (cl.own_instances || []).forEach(inst => {
      map[inst.id] = {
        clusterId: cl.id, name: inst.name, svcType: cl.service_type,
        ownServices: inst.own_services || [],
      };
    });
  });
  return map;
}

/**
 * Creates a button that opens a small dropdown to pick from a list of items.
 * @param {string}   label     Button label text
 * @param {Array|Function} items  Array of {id, label, color?} or a function returning such array
 * @param {Function} onSelect  Called with the selected item's id
 * @param {string}   [emptyText] Text shown when the list is empty
 */
export function makeInstDropdownBtn(label, items, onSelect, emptyText) {
  const wrap = document.createElement('div');
  wrap.style.position = 'relative';

  const btn = document.createElement('button');
  btn.className = 'xs';
  btn.innerHTML = '<i class="fa-solid fa-plus"></i> ' + label;

  const dd = document.createElement('div');
  dd.className = 'inst-dropdown';
  dd.style.cssText = 'display:none;position:absolute;top:100%;left:0;z-index:300;' +
    'background:#1e293b;border:1px solid #334155;border-radius:6px;' +
    'min-width:150px;max-height:200px;overflow-y:auto;margin-top:2px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.5)';

  btn.onclick = e => {
    e.stopPropagation();
    document.querySelectorAll('.inst-dropdown').forEach(d => { if (d !== dd) d.style.display = 'none'; });
    if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }
    const list = typeof items === 'function' ? items() : items;
    dd.innerHTML = '';
    if (!list.length) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:8px 12px;font-size:0.8rem;color:#6b7280';
      msg.textContent = emptyText || 'Keine Einträge';
      dd.appendChild(msg);
    } else {
      list.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:0.82rem;display:flex;align-items:center;gap:8px';
        if (item.color) {
          row.innerHTML = '<span style="width:9px;height:9px;border-radius:50%;background:' + item.color +
            ';display:inline-block;flex-shrink:0"></span>' + escHtml(item.label);
        } else {
          row.textContent = item.label;
        }
        row.onmouseenter = () => row.style.background = '#334155';
        row.onmouseleave = () => row.style.background = '';
        row.onclick = ev => { ev.stopPropagation(); dd.style.display = 'none'; onSelect(item.id); };
        dd.appendChild(row);
      });
    }
    dd.style.display = 'block';
  };

  wrap.appendChild(btn);
  wrap.appendChild(dd);
  return wrap;
}

/**
 * Checks the Zabbix connection status and updates the scan button styling.
 */
export async function checkZabbixStatus() {
  const btn = document.getElementById('zbx-btn');
  btn.title = 'Prüfe Verbindung…';
  btn.style.outline = '';
  btn.style.background = '';
  try {
    const r = await fetch('/api/zabbix/ping');
    const data = await r.json();
    if (data.status === 'ok') {
      btn.style.outline = '2px solid #22c55e';
      btn.style.background = '';
      btn.title = data.message;
    } else {
      btn.style.background = '#7f1d1d';
      btn.style.outline = '';
      btn.title = data.message;
    }
  } catch (e) {
    btn.style.background = '#7f1d1d';
    btn.style.outline = '';
    btn.title = 'Verbindungsfehler: ' + e.message;
  }
}

/**
 * Returns the next unused auto-colour from the palette, cycling when exhausted.
 */
export function nextColor(usedColors) {
  for (const c of AUTO_COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  return AUTO_COLORS[usedColors.length % AUTO_COLORS.length];
}
