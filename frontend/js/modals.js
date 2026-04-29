/*
 * modals.js — all modal open/close/save functions for servers, environments,
 *             applications, clusters, internet routers, and Zabbix scan.
 * Exports: openAddServer, openManageEnvironments, openManageApplications,
 *          openManageClusters, openManageInternet, openZabbixScan, closeModal, initModals.
 */
'use strict';

import {
  allServers, allEnvironments, allApplications, allClusters, allRouters,
  SVC_COLORS,
  zbxScanData, setZbxScanData,
} from './state.js';

import { api, loadAll } from './api.js';
import { escHtml, nextColor } from './utils.js';
import { renderClusterList } from './cluster.js';

// ── Generic ───────────────────────────────────────────────────────────────────

/**
 * Closes any modal by removing its 'open' class.
 */
export function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ── Add server modal ──────────────────────────────────────────────────────────

/**
 * Opens the add-server modal.
 */
export function openAddServer() {
  document.getElementById('modal-add-server').classList.add('open');
}

/**
 * Creates a new server from the add-server modal form and reloads.
 */
export async function createServer() {
  const hostname = document.getElementById('new-hostname').value.trim();
  if (!hostname) return alert('Hostname fehlt');
  try {
    await api('POST', '/servers', {
      hostname,
      ip:          document.getElementById('new-ip').value || null,
      os_type:     document.getElementById('new-os').value,
      description: document.getElementById('new-desc').value || null,
      is_gateway:  document.getElementById('new-is-gateway').checked,
    });
  } catch (e) { return alert('Fehler: ' + e.message); }
  closeModal('modal-add-server');
  ['new-hostname', 'new-ip', 'new-desc'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('new-is-gateway').checked = false;
  await loadAll();
}

// ── Manage environments modal ─────────────────────────────────────────────────

/**
 * Opens the environments management modal and renders the list.
 */
export function openManageEnvironments() {
  renderEnvList();
  document.getElementById('modal-environments').classList.add('open');
}

function renderEnvList() {
  const list = document.getElementById('env-list');
  list.innerHTML = '';
  [...allEnvironments].sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-bottom:1px solid #0f3460;padding:6px 0';

    const row = document.createElement('div');
    row.className = 'list-item';
    row.style.borderBottom = 'none';

    const dotEl = document.createElement('div');
    dotEl.className = 'dot';
    dotEl.style.cssText = 'background:' + e.color + ';cursor:pointer';
    dotEl.title = 'Farbe ändern';
    dotEl.addEventListener('click', () => pickEnvColor(e.id, dotEl));
    row.appendChild(dotEl);

    row.innerHTML += '<span style="flex:1;font-weight:500">' + escHtml(e.name) + '</span>' +
      (e.subnet ? '<span style="font-size:0.72rem;color:#60a5fa;margin-right:4px">' + escHtml(e.subnet) + '</span>' : '') +
      (e.default_gateway_router_id ? (() => { const r = allRouters.find(r => r.id === e.default_gateway_router_id); return r ? '<span style="font-size:0.72rem;color:#fb923c">GW: ' + escHtml(r.name) + '</span>' : ''; })() :
       e.default_gateway_server_id  ? (() => { const s = allServers.find(s => s.id === e.default_gateway_server_id);  return s ? '<span style="font-size:0.72rem;color:#22d3ee">GW: ' + escHtml(s.hostname) + '</span>' : ''; })() : '');

    const editBtn = document.createElement('button');
    editBtn.className = 'xs'; editBtn.style.marginLeft = '6px';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.addEventListener('click', () => toggleEnvEdit(e.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger';
    delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => deleteEnvironment(e.id));
    row.appendChild(editBtn); row.appendChild(delBtn);
    wrap.appendChild(row);

    const form = document.createElement('div');
    form.id = 'env-edit-' + e.id;
    form.style.cssText = 'display:none;flex-direction:column;gap:5px;padding:6px 0 2px 18px';
    form.innerHTML =
      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
        '<input type="text" id="ee-name-' + e.id + '" value="' + escHtml(e.name) + '" placeholder="Name" style="flex:1;min-width:100px"/>' +
        '<input type="text" id="ee-subnet-' + e.id + '" value="' + escHtml(e.subnet || '') + '" placeholder="Subnetz z.B. 192.168.1.0/24" style="flex:2;min-width:130px"/>' +
        '<select id="ee-gw-router-' + e.id + '" style="flex:1;min-width:120px">' +
          '<option value="">— kein Standard-GW —</option>' +
          (allRouters.length ? '<optgroup label="Anschlüsse">' +
            allRouters.map(r => '<option value="router_' + r.id + '"' + (e.default_gateway_router_id === r.id ? ' selected' : '') + '>' +
              escHtml(r.name) + (r.internal_ip ? ' (' + r.internal_ip + ')' : '') + '</option>').join('') +
          '</optgroup>' : '') +
          (allServers.some(s => s.is_gateway) ? '<optgroup label="GW-Server">' +
            allServers.filter(s => s.is_gateway).map(s => '<option value="server_' + s.id + '"' + (e.default_gateway_server_id === s.id ? ' selected' : '') + '>' +
              escHtml(s.hostname) + (s.ip ? ' (' + s.ip + ')' : '') + '</option>').join('') +
          '</optgroup>' : '') +
        '</select>' +
        '<input type="color" id="ee-color-' + e.id + '" value="' + e.color + '" style="width:34px;padding:2px"/>' +
      '</div>' +
      '<div style="display:flex;gap:5px">' +
        '<button class="small" id="ee-save-' + e.id + '">Speichern</button>' +
        '<button class="small" id="ee-cancel-' + e.id + '">Abbrechen</button>' +
      '</div>';
    wrap.appendChild(form);
    list.appendChild(wrap);

    // Attach save/cancel listeners after DOM insert
    document.getElementById('ee-save-' + e.id).addEventListener('click', () => saveEnvEdit(e.id));
    document.getElementById('ee-cancel-' + e.id).addEventListener('click', () => toggleEnvEdit(e.id));
  });
}

function toggleEnvEdit(envId) {
  const f = document.getElementById('env-edit-' + envId);
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

function pickEnvColor(envId, dotEl) {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = dotEl.style.background;
  inp.style.position = 'fixed'; inp.style.opacity = '0';
  document.body.appendChild(inp);
  inp.click();
  inp.addEventListener('change', async () => {
    try { await api('PUT', '/environments/' + envId, { color: inp.value }); }
    catch (e) { return alert('Fehler: ' + e.message); }
    await loadAll(); renderEnvList();
    document.body.removeChild(inp);
  });
  inp.addEventListener('blur', () => { setTimeout(() => { if (document.body.contains(inp)) document.body.removeChild(inp); }, 200); });
}

async function saveEnvEdit(envId) {
  const name   = document.getElementById('ee-name-'   + envId).value.trim();
  const subnet = document.getElementById('ee-subnet-' + envId).value.trim() || null;
  const color  = document.getElementById('ee-color-'  + envId).value;
  const gwSel  = document.getElementById('ee-gw-router-' + envId);
  const gwVal  = gwSel ? gwSel.value : '';
  const default_gateway_router_id = gwVal.startsWith('router_') ? parseInt(gwVal.replace('router_', '')) : null;
  const default_gateway_server_id = gwVal.startsWith('server_') ? parseInt(gwVal.replace('server_', '')) : null;
  if (!name) return alert('Name fehlt');
  try { await api('PUT', '/environments/' + envId, { name, subnet, color, default_gateway_router_id, default_gateway_server_id }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll(); renderEnvList();
}

/**
 * Creates a new environment from the modal form.
 */
export async function createEnvironment() {
  const name        = document.getElementById('new-env-name').value.trim();
  const description = document.getElementById('new-env-desc').value || null;
  const subnet      = document.getElementById('new-env-subnet').value.trim() || null;
  if (!name) return;
  const color = nextColor(allEnvironments.map(e => e.color));
  try { await api('POST', '/environments', { name, description, color, subnet }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  ['new-env-name', 'new-env-desc', 'new-env-subnet'].forEach(id => document.getElementById(id).value = '');
  await loadAll();
  renderEnvList();
}

async function deleteEnvironment(envId) {
  try { await api('DELETE', '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderEnvList();
}

// ── Manage applications modal ─────────────────────────────────────────────────

/**
 * Opens the applications management modal and renders the list.
 */
export function openManageApplications() {
  renderAppList();
  document.getElementById('modal-applications').classList.add('open');
}

function renderAppList() {
  const list = document.getElementById('app-list');
  list.innerHTML = '';
  [...allApplications].sort((a, b) => a.name.localeCompare(b.name)).forEach(a => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = '<div class="dot" style="background:' + a.color + '"></div>' +
      '<span style="flex:1">' + escHtml(a.name) + '</span>' +
      (a.description ? '<span style="font-size:0.75rem;color:#6b7280">' + escHtml(a.description) + '</span>' : '');
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger'; delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => deleteApplication(a.id));
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

/**
 * Creates a new application from the modal form.
 */
export async function createApplication() {
  const name        = document.getElementById('new-app-name').value.trim();
  const description = document.getElementById('new-app-desc').value || null;
  if (!name) return;
  const color = nextColor(allApplications.map(a => a.color));
  try { await api('POST', '/applications', { name, description, color }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  document.getElementById('new-app-name').value = '';
  document.getElementById('new-app-desc').value = '';
  await loadAll();
  renderAppList();
}

async function deleteApplication(appId) {
  try { await api('DELETE', '/applications/' + appId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderAppList();
}

// ── Manage clusters modal ─────────────────────────────────────────────────────

/**
 * Opens the cluster management modal and renders the list.
 */
export function openManageClusters() {
  renderClusterList();
  document.getElementById('modal-clusters').classList.add('open');
}

/**
 * Creates a new cluster from the modal form.
 */
export async function createCluster() {
  const name         = document.getElementById('new-cluster-name').value.trim();
  const description  = document.getElementById('new-cluster-desc').value.trim() || null;
  const domain       = document.getElementById('new-cluster-domain').value.trim() || null;
  const service_type = document.getElementById('new-cluster-type').value;
  if (!name) return alert('Name fehlt');
  try { await api('POST', '/clusters', { name, description, service_type, domain }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  document.getElementById('new-cluster-name').value = '';
  document.getElementById('new-cluster-desc').value = '';
  document.getElementById('new-cluster-domain').value = '';
  await loadAll();
  renderClusterList();
}

// ── Manage internet modal ─────────────────────────────────────────────────────

/**
 * Opens the internet/router management modal and renders the list.
 */
export function openManageInternet() {
  _fillUpstreamSelect('new-router-upstream', null);
  _fillServerSelect('new-router-server', null);
  _buildEnvCheckboxes('new-router-envs', []);
  renderInternetList();
  document.getElementById('modal-internet').classList.add('open');
}

function _buildEnvCheckboxes(containerId, checkedIds) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  if (!allEnvironments.length) {
    c.innerHTML = '<span style="font-size:0.75rem;color:#6b7280">Keine Umgebungen vorhanden</span>';
    return;
  }
  allEnvironments.forEach(e => {
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:0.78rem;cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = e.id;
    cb.checked = (checkedIds || []).includes(e.id);
    lbl.appendChild(cb);
    const dot = document.createElement('span');
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:' + e.color + ';flex-shrink:0';
    lbl.appendChild(dot);
    lbl.appendChild(document.createTextNode(e.name + (e.subnet ? ' — ' + e.subnet : '')));
    c.appendChild(lbl);
  });
}

function _collectEnvIds(containerId) {
  return Array.from(document.querySelectorAll('#' + containerId + ' input[type=checkbox]:checked'))
    .map(cb => parseInt(cb.value));
}

function _fillUpstreamSelect(selId, excludeId) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option value="">— Kein Upstream —</option>';
  allRouters.forEach(r => {
    if (r.id === excludeId) return;
    const o = document.createElement('option'); o.value = r.id; o.textContent = r.name; sel.appendChild(o);
  });
}

function _fillServerSelect(selId, currentVal) {
  const sel = document.getElementById(selId);
  sel.innerHTML = '<option value="">— Kein verknüpfter Server —</option>';
  allServers.forEach(s => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.hostname;
    if (s.id === currentVal) o.selected = true;
    sel.appendChild(o);
  });
}

function renderInternetList() {
  const list = document.getElementById('internet-router-list');
  list.innerHTML = '';
  if (!allRouters.length) {
    list.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;padding:4px 0">Keine Einträge</div>';
    return;
  }
  allRouters.forEach(r => {
    const upstream  = r.upstream_router_id ? allRouters.find(u => u.id === r.upstream_router_id) : null;
    const linkedSrv = r.server_id ? allServers.find(s => s.id === r.server_id) : null;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-bottom:1px solid #0f3460;padding:5px 0';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:flex-start;gap:6px';
    row.innerHTML =
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' +
          '<span style="color:#fed7aa;font-weight:600">🔒 ' + escHtml(r.name) + '</span>' +
          (r.provider   ? '<span style="color:#9ca3af;font-size:0.75rem">' + escHtml(r.provider) + '</span>' : '') +
          (linkedSrv    ? '<span style="font-size:0.72rem;background:#1e3a5f;border-radius:3px;padding:1px 5px;color:#93c5fd">⇒ ' + escHtml(linkedSrv.hostname) + '</span>' : '') +
          (upstream     ? '<span style="font-size:0.72rem;color:#6b7280">↑ ' + escHtml(upstream.name) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:0.74rem;color:#6b7280;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">' +
          (r.external_ip ? 'Ext: <span style="color:#93c5fd">' + escHtml(r.external_ip) + '</span>' : '') +
          (r.internal_ip ? '&nbsp;Int: <span style="color:#6ee7b7">' + escHtml(r.internal_ip) + '</span>' : '') +
        '</div>' +
        ((r.environments || []).length ? '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px">' +
          r.environments.map(e => '<span style="background:' + e.color + '22;border:1px solid ' + e.color + '66;border-radius:3px;padding:0 5px;font-size:0.72rem;color:' + e.color + '">' + escHtml(e.name) + (e.subnet ? ' ' + escHtml(e.subnet) : '') + '</span>').join('') +
        '</div>' : '') +
      '</div>';

    const btnWrap = document.createElement('div');
    btnWrap.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
    const editBtn = document.createElement('button');
    editBtn.className = 'xs'; editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.addEventListener('click', () => toggleRouterEdit(r.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger'; delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => deleteInternetRouter(r.id));
    btnWrap.appendChild(editBtn); btnWrap.appendChild(delBtn);
    row.appendChild(btnWrap);
    wrap.appendChild(row);

    const form = document.createElement('div');
    form.id = 're-form-' + r.id;
    form.style.cssText = 'display:none;flex-direction:column;gap:5px;padding:8px 0 4px 4px;margin-top:4px';
    form.innerHTML =
      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
        '<input type="text" id="re-name-' + r.id + '" value="' + escHtml(r.name) + '" placeholder="Name *" style="flex:1;min-width:120px"/>' +
        '<input type="text" id="re-provider-' + r.id + '" value="' + escHtml(r.provider || '') + '" placeholder="Anbieter" style="flex:1;min-width:100px"/>' +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
        '<input type="text" id="re-ext-' + r.id + '" value="' + escHtml(r.external_ip || '') + '" placeholder="Externe IP / DHCP" style="flex:1;min-width:120px"/>' +
        '<input type="text" id="re-int-' + r.id + '" value="' + escHtml(r.internal_ip || '') + '" placeholder="Interne IP" style="flex:1;min-width:100px"/>' +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
        '<select id="re-upstream-' + r.id + '" style="flex:1"></select>' +
        '<select id="re-server-' + r.id + '" style="flex:1"></select>' +
      '</div>' +
      '<div style="font-size:0.74rem;color:#6b7280">Umgebungen:</div>' +
      '<div id="re-envs-' + r.id + '" style="display:flex;flex-direction:column;gap:3px;max-height:100px;overflow-y:auto;background:#0a1628;border-radius:4px;padding:5px"></div>' +
      '<div style="display:flex;gap:5px">' +
        '<button class="small" id="re-save-' + r.id + '">Speichern</button>' +
        '<button class="small" id="re-cancel-' + r.id + '">Abbrechen</button>' +
      '</div>';
    wrap.appendChild(form);
    list.appendChild(wrap);

    // Deferred population of selects + listeners
    setTimeout(() => {
      _fillUpstreamSelect('re-upstream-' + r.id, r.id);
      document.getElementById('re-upstream-' + r.id).value = r.upstream_router_id || '';
      _fillServerSelect('re-server-' + r.id, r.server_id);
      _buildEnvCheckboxes('re-envs-' + r.id, (r.environments || []).map(e => e.id));
      document.getElementById('re-save-' + r.id).addEventListener('click', () => saveRouterEdit(r.id));
      document.getElementById('re-cancel-' + r.id).addEventListener('click', () => toggleRouterEdit(r.id));
    }, 0);
  });
}

function toggleRouterEdit(routerId) {
  const f = document.getElementById('re-form-' + routerId);
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

async function saveRouterEdit(routerId) {
  const name = document.getElementById('re-name-' + routerId).value.trim();
  if (!name) return alert('Name fehlt');
  const payload = {
    name,
    provider:           document.getElementById('re-provider-' + routerId).value.trim() || null,
    external_ip:        document.getElementById('re-ext-'      + routerId).value.trim() || null,
    internal_ip:        document.getElementById('re-int-'      + routerId).value.trim() || null,
    upstream_router_id: parseInt(document.getElementById('re-upstream-' + routerId).value) || null,
    server_id:          parseInt(document.getElementById('re-server-'   + routerId).value) || null,
    environment_ids:    _collectEnvIds('re-envs-' + routerId),
  };
  try { await api('PUT', '/internet-routers/' + routerId, payload); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderInternetList();
}

/**
 * Creates a new internet router from the modal form.
 */
export async function createInternetRouter() {
  const name = document.getElementById('new-router-name').value.trim();
  if (!name) return alert('Routername fehlt');
  const payload = {
    name,
    provider:           document.getElementById('new-router-provider').value.trim() || null,
    external_ip:        document.getElementById('new-router-ext-ip').value.trim() || null,
    internal_ip:        document.getElementById('new-router-int-ip').value.trim() || null,
    upstream_router_id: parseInt(document.getElementById('new-router-upstream').value) || null,
    server_id:          parseInt(document.getElementById('new-router-server').value) || null,
    environment_ids:    _collectEnvIds('new-router-envs'),
  };
  try { await api('POST', '/internet-routers', payload); }
  catch (e) { return alert('Fehler: ' + e.message); }
  ['new-router-name', 'new-router-provider', 'new-router-ext-ip', 'new-router-int-ip']
    .forEach(id => document.getElementById(id).value = '');
  await loadAll();
  openManageInternet();
}

async function deleteInternetRouter(id) {
  try { await api('DELETE', '/internet-routers/' + id); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderInternetList();
}

// ── Zabbix scan modal ─────────────────────────────────────────────────────────

/**
 * Opens the Zabbix scan modal and loads available hosts from the API.
 */
export async function openZabbixScan() {
  setZbxScanData(null);
  document.getElementById('zbx-step-hosts').style.display = '';
  document.getElementById('zbx-step-result').style.display = 'none';
  document.getElementById('modal-zabbix').classList.add('open');
  const sel = document.getElementById('zbx-host-select');
  sel.innerHTML = '<option value="">— Lädt… —</option>';
  try {
    const hosts = await api('GET', '/zabbix/hosts');
    sel.innerHTML = '';
    if (!hosts.length) { sel.innerHTML = '<option value="">Keine Hosts gefunden</option>'; return; }
    const existingHostnames = new Set(allServers.map(s => s.hostname.toLowerCase()));
    hosts.forEach(h => {
      const o = document.createElement('option');
      o.value = h.hostid;
      const exists = existingHostnames.has(h.hostname.toLowerCase());
      if (exists) {
        o.textContent = '✓ ' + h.hostname + (h.ip ? ' (' + h.ip + ')' : '') + ' — bereits vorhanden';
        o.disabled = true;
        o.style.color = '#6b7280';
      } else {
        o.textContent = h.hostname + (h.ip ? ' (' + h.ip + ')' : '');
      }
      sel.appendChild(o);
    });
  } catch (e) {
    sel.innerHTML = '<option value="">Fehler: ' + escHtml(e.message) + '</option>';
  }
}

/**
 * Runs the Zabbix scan for the selected host and shows the result step.
 */
export async function runZabbixScan() {
  const hostid = document.getElementById('zbx-host-select').value;
  if (!hostid) return alert('Bitte Host auswählen');
  const btn = document.getElementById('zbx-scan-btn');
  btn.disabled = true; btn.textContent = 'Scannt…';
  try {
    setZbxScanData(await api('GET', '/zabbix/scan/' + hostid));
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Scannen';
    return alert('Scan fehlgeschlagen: ' + e.message);
  }
  btn.disabled = false; btn.textContent = 'Scannen';
  renderZabbixResult();
}

function renderZabbixResult() {
  if (!zbxScanData) return;
  const d = zbxScanData;
  document.getElementById('zbx-step-hosts').style.display = 'none';
  document.getElementById('zbx-step-result').style.display = '';
  document.getElementById('zbx-result-info').innerHTML =
    '<b>' + escHtml(d.hostname) + '</b>' +
    (d.ip ? ' &nbsp;IP: ' + escHtml(d.ip) : '') +
    ' &nbsp;OS: ' + escHtml(d.os_type);
  const container = document.getElementById('zbx-result-services');
  container.innerHTML = '';
  if (!d.services || !d.services.length) {
    container.innerHTML = '<div style="color:#6b7280;font-size:0.82rem">Keine Services erkannt</div>';
    return;
  }
  d.services.forEach(svc => {
    const col = SVC_COLORS[svc.type] || '#4b5563';
    const block = document.createElement('div');
    block.className = 'svc-block';
    block.innerHTML = '<div class="svc-title" style="color:' + col + ';margin-bottom:4px">' +
      escHtml(svc.type) + (svc.version ? ' ' + escHtml(svc.version) : '') + '</div>';
    if (svc.instances && svc.instances.length) {
      const ul = document.createElement('div');
      ul.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:2px';
      svc.instances.forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'chip'; chip.style.background = col; chip.textContent = name;
        ul.appendChild(chip);
      });
      block.appendChild(ul);
    } else {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:0.75rem;color:#6b7280'; note.textContent = 'Keine Instanzen erkannt';
      block.appendChild(note);
    }
    container.appendChild(block);
  });
}

/** Goes back to the host-selection step in the Zabbix scan modal. */
export function zbxBack() {
  setZbxScanData(null);
  document.getElementById('zbx-step-hosts').style.display = '';
  document.getElementById('zbx-step-result').style.display = 'none';
}

/**
 * Imports the scanned Zabbix data into the database.
 */
export async function zbxImport() {
  if (!zbxScanData) return;
  try {
    const result = await api('POST', '/zabbix/import', zbxScanData);
    alert('Importiert: ' + result.hostname + ' (ID ' + result.server_id + ')');
  } catch (e) { return alert('Import fehlgeschlagen: ' + e.message); }
  closeModal('modal-zabbix');
  await loadAll();
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up all modal button event listeners.
 */
export function initModals() {
  // Backdrop click to close
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });

  // Topbar buttons
  document.getElementById('btn-manage-internet').addEventListener('click', openManageInternet);
  document.getElementById('btn-add-server').addEventListener('click', openAddServer);
  document.getElementById('btn-manage-envs').addEventListener('click', openManageEnvironments);
  document.getElementById('btn-manage-apps').addEventListener('click', openManageApplications);
  document.getElementById('btn-manage-clusters').addEventListener('click', openManageClusters);
  document.getElementById('zbx-btn').addEventListener('click', openZabbixScan);

  // Modal action buttons
  document.getElementById('close-modal-add-server').addEventListener('click', () => closeModal('modal-add-server'));
  document.getElementById('create-server-btn').addEventListener('click', createServer);
  document.getElementById('close-modal-envs').addEventListener('click', () => closeModal('modal-environments'));
  document.getElementById('create-env-btn').addEventListener('click', createEnvironment);
  document.getElementById('close-modal-apps').addEventListener('click', () => closeModal('modal-applications'));
  document.getElementById('create-app-btn').addEventListener('click', createApplication);
  document.getElementById('close-modal-clusters').addEventListener('click', () => closeModal('modal-clusters'));
  document.getElementById('create-cluster-btn').addEventListener('click', createCluster);
  document.getElementById('close-modal-internet').addEventListener('click', () => closeModal('modal-internet'));
  document.getElementById('create-router-btn').addEventListener('click', createInternetRouter);
  document.getElementById('close-modal-zabbix').addEventListener('click', () => closeModal('modal-zabbix'));
  document.getElementById('zbx-scan-btn').addEventListener('click', runZabbixScan);
  document.getElementById('zbx-back-btn').addEventListener('click', zbxBack);
  document.getElementById('zbx-import-btn').addEventListener('click', zbxImport);
}
