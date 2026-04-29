/*
 * utils.js — shared helper utilities used across multiple modules.
 * Exports: escHtml, buildInstServerMap, makeInstDropdownBtn, checkZabbixStatus, nextColor.
 */
'use strict';

import {
  allServers, allClusters, allRouters,
  SVC_COLORS,
} from './state.js';

/**
 * Escapes HTML special characters to prevent XSS in innerHTML assignments.
 */
export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const AUTO_COLORS = [
    '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
    '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1',
    '#14b8a6','#eab308','#a855f7','#0ea5e9','#22c55e',
  ];
  for (const c of AUTO_COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  return AUTO_COLORS[usedColors.length % AUTO_COLORS.length];
}
