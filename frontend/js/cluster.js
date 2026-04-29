/*
 * cluster.js — cluster sidebar open/close, own-instance rendering, member management,
 *              cluster-level instance relations, and cluster sidebar edit.
 * Exports: openClusterSidebar, closeClusterSidebar, renderClusterList, initCluster.
 */
'use strict';

import {
  allServers, allClusters, allEnvironments, allInstanceRelations, allRouters,
  currentClusterId, setCurrentClusterId,
  setCurrentServerId,
  SVC_COLORS,
} from './state.js';

import { api, loadAll } from './api.js';
import { escHtml, buildInstServerMap } from './utils.js';
import { startEditInstRel } from './sidebar.js';

// ── Cluster sidebar ───────────────────────────────────────────────────────────

/**
 * Opens the cluster sidebar for the given cluster ID and populates all sections.
 */
export function openClusterSidebar(clusterId) {
  const cl = allClusters.find(c => c.id === clusterId);
  if (!cl) return;
  setCurrentClusterId(clusterId);
  setCurrentServerId(null);
  document.getElementById('srv-sidebar').style.display = 'none';
  const clSb = document.getElementById('cl-sidebar');
  clSb.style.display = 'flex';
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-resizer').style.display = 'block';

  const col = SVC_COLORS[cl.service_type] || '#4b5563';
  const nameEl = document.getElementById('cl-sb-name');
  nameEl.textContent = '◆ ' + cl.name;
  nameEl.style.color = col;
  document.getElementById('cl-sb-type').textContent = cl.service_type;
  const domRow = document.getElementById('cl-sb-domain-row');
  if (cl.domain) { document.getElementById('cl-sb-domain').textContent = cl.domain; domRow.style.display = ''; }
  else { domRow.style.display = 'none'; }
  document.getElementById('cl-sb-desc').textContent = cl.description || '—';
  document.getElementById('cl-sb-edit-form').style.display = 'none';

  renderClusterOwnInstances(cl);
  renderClusterMembersInSidebar(cl);

  const srvSel = document.getElementById('cl-sb-srv-sel');
  srvSel.innerHTML = '';
  [...allServers].sort((a, b) => a.hostname.localeCompare(b.hostname)).forEach(s => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.hostname; srvSel.appendChild(o);
  });
  populateClusterSbInstSel();

  const irSrc = document.getElementById('cl-ir-src');
  irSrc.innerHTML = '';
  const clGrp = document.createElement('optgroup'); clGrp.label = 'Dieser Cluster';
  const clO = document.createElement('option');
  clO.value = 'cluster_' + cl.id;
  clO.textContent = '◆ ' + cl.name;
  clGrp.appendChild(clO);
  irSrc.appendChild(clGrp);
  if ((cl.own_instances || []).length) {
    const instGrp = document.createElement('optgroup'); instGrp.label = 'Eigene Instanzen';
    cl.own_instances.forEach(inst => {
      const o = document.createElement('option'); o.value = 'inst_' + inst.id; o.textContent = inst.name; instGrp.appendChild(o);
    });
    irSrc.appendChild(instGrp);
  }

  const tgtSel = document.getElementById('cl-ir-tgt-srv');
  tgtSel.innerHTML = '<option value="">— Cluster als Ziel —</option>';
  allClusters.filter(c => c.id !== clusterId).forEach(c => {
    const o = document.createElement('option'); o.value = 'cluster_' + c.id; o.textContent = '◆ ' + c.name; tgtSel.appendChild(o);
  });
  const srvGrp = document.createElement('optgroup'); srvGrp.label = 'Server';
  [...allServers].sort((a, b) => a.hostname.localeCompare(b.hostname)).forEach(s => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.hostname; srvGrp.appendChild(o);
  });
  tgtSel.appendChild(srvGrp);
  updateClusterIrTgtInst();
  renderClusterInstRelSection();
}

/**
 * Closes the cluster sidebar (delegates to the shared closeSidebar in sidebar.js).
 * This function is kept here for symmetry and direct import.
 */
export { closeSidebar as closeClusterSidebar } from './sidebar.js';

// ── Cluster sidebar edit ──────────────────────────────────────────────────────

/** Toggles the inline cluster name/description/domain edit form. */
export function toggleClusterSidebarEdit() {
  const form = document.getElementById('cl-sb-edit-form');
  if (form.style.display === 'none') {
    const cl = allClusters.find(c => c.id === currentClusterId);
    if (!cl) return;
    document.getElementById('cl-edit-name').value = cl.name;
    document.getElementById('cl-edit-domain').value = cl.domain || '';
    document.getElementById('cl-edit-desc').value = cl.description || '';
    form.style.display = 'flex';
  } else {
    form.style.display = 'none';
  }
}

/**
 * Saves the cluster sidebar inline edit form.
 */
export async function saveClusterSidebarEdit() {
  const name        = document.getElementById('cl-edit-name').value.trim();
  const domain      = document.getElementById('cl-edit-domain').value.trim() || null;
  const description = document.getElementById('cl-edit-desc').value.trim() || null;
  if (!name) return alert('Name fehlt');
  try { await api('PATCH', '/clusters/' + currentClusterId, { name, domain, description }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

/**
 * Deletes the currently open cluster after confirmation.
 */
export async function deleteCurrentCluster() {
  if (!confirm('Cluster löschen?')) return;
  try { await api('DELETE', '/clusters/' + currentClusterId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  // closeSidebar imported below
  const { closeSidebar } = await import('./sidebar.js');
  closeSidebar();
}

// ── Cluster own instances ─────────────────────────────────────────────────────

/** Renders the own-instances section of the cluster sidebar. */
function renderClusterOwnInstances(cl) {
  const container = document.getElementById('cl-sb-own-insts');
  container.innerHTML = '';
  if (!cl.own_instances || !cl.own_instances.length) {
    container.innerHTML = '<div style="font-size:0.78rem;color:#6b7280;padding:3px 0">Keine eigenen Instanzen</div>';
    return;
  }
  cl.own_instances.forEach(inst => {
    const row = document.createElement('div');
    row.style.cssText = 'border-bottom:1px solid #0f3460;padding:5px 0';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap';
    header.innerHTML = '<span style="font-size:0.8rem;font-weight:500">' + escHtml(inst.name) + '</span>' +
      (inst.fqdn ? '<span style="font-size:0.72rem;color:#60a5fa;font-family:monospace">' + escHtml(inst.fqdn) + '</span>' : '') +
      (inst.ip ? '<span style="font-size:0.7rem;color:#9ca3af">' + escHtml(inst.ip) + '</span>' : '');
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger'; delBtn.style.marginLeft = 'auto';
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    delBtn.onclick = () => deleteClusterOwnInstance(inst.id);
    header.appendChild(delBtn);
    row.appendChild(header);
    const chips = document.createElement('div');
    chips.className = 'instance-chips';
    (inst.environments || []).forEach(env => {
      const c = document.createElement('span');
      c.className = 'chip'; c.style.background = env.color;
      c.innerHTML = '🌍 ' + escHtml(env.name) + ' <i class="fa-solid fa-xmark" style="font-size:0.6rem"></i>';
      c.onclick = () => removeClusterInstEnv(inst.id, env.id);
      chips.appendChild(c);
    });
    if (allEnvironments.length) {
      const envSel = document.createElement('select');
      envSel.style.cssText = 'font-size:0.72rem;padding:2px 4px;background:#0f3460;color:#e0e0e0;border:1px solid #1d4ed8;border-radius:3px';
      allEnvironments.forEach(e => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; envSel.appendChild(o); });
      const envBtn = document.createElement('button');
      envBtn.className = 'xs'; envBtn.textContent = '+Umgeb.';
      envBtn.onclick = () => addClusterInstEnv(inst.id, parseInt(envSel.value));
      chips.appendChild(envSel);
      chips.appendChild(envBtn);
    }
    row.appendChild(chips);
    container.appendChild(row);
  });
}

/** Renders the members chip list of the cluster sidebar. */
function renderClusterMembersInSidebar(cl) {
  const container = document.getElementById('cl-sb-members');
  container.innerHTML = '';
  if (!cl.members || !cl.members.length) {
    container.innerHTML = '<div style="font-size:0.78rem;color:#6b7280;padding:3px 0">Keine Mitglieder</div>';
    return;
  }
  const instMap = buildInstServerMap();
  const col = SVC_COLORS[cl.service_type] || '#4b5563';
  const chips = document.createElement('div');
  chips.className = 'chips';
  cl.members.forEach(m => {
    const info = instMap[m.id];
    const srv = info ? allServers.find(s => s.id === info.serverId) : null;
    const label = srv ? srv.hostname + ' / ' + m.name : m.name;
    const c = document.createElement('span');
    c.className = 'chip'; c.style.cssText = 'background:' + col + '55;outline:1px solid ' + col;
    c.innerHTML = escHtml(label) + ' <i class="fa-solid fa-xmark" style="font-size:0.6rem"></i>';
    c.onclick = () => removeMemberFromClusterSidebar(cl.id, m.id);
    chips.appendChild(c);
  });
  container.appendChild(chips);
}

// ── Cluster member management ─────────────────────────────────────────────────

/**
 * Populates the instance selector for the cluster sidebar member-add form.
 */
export function populateClusterSbInstSel() {
  const srvId = parseInt(document.getElementById('cl-sb-srv-sel').value);
  const cl = allClusters.find(c => c.id === currentClusterId);
  const instSel = document.getElementById('cl-sb-inst-sel');
  instSel.innerHTML = '';
  const srv = allServers.find(s => s.id === srvId);
  if (!srv) return;
  [...(srv.services || [])].filter(svc => !cl || svc.type === cl.service_type).forEach(svc => {
    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const o = document.createElement('option'); o.value = inst.id; o.textContent = inst.name; instSel.appendChild(o);
    });
  });
}

/**
 * Adds the selected instance as a cluster member from the sidebar.
 */
export async function addClusterMemberFromSidebar() {
  const instanceId = parseInt(document.getElementById('cl-sb-inst-sel').value);
  if (!instanceId) return alert('Bitte Instanz auswählen');
  try { await api('POST', '/clusters/' + currentClusterId + '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function removeMemberFromClusterSidebar(clusterId, instanceId) {
  try { await api('DELETE', '/clusters/' + clusterId + '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

/**
 * Creates a new own-instance for the current cluster from the sidebar form.
 */
export async function addClusterOwnInstance() {
  const name = document.getElementById('cl-new-inst-name').value.trim();
  const fqdn = document.getElementById('cl-new-inst-fqdn').value.trim() || null;
  const ip   = document.getElementById('cl-new-inst-ip').value.trim()   || null;
  if (!name) return alert('Name fehlt');
  try { await api('POST', '/clusters/' + currentClusterId + '/own-instances', { name, fqdn, ip }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  document.getElementById('cl-new-inst-name').value = '';
  document.getElementById('cl-new-inst-fqdn').value = '';
  document.getElementById('cl-new-inst-ip').value = '';
  await loadAll();
}

async function deleteClusterOwnInstance(instanceId) {
  try { await api('DELETE', '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function addClusterInstEnv(instanceId, envId) {
  try { await api('POST', '/instances/' + instanceId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function removeClusterInstEnv(instanceId, envId) {
  try { await api('DELETE', '/instances/' + instanceId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

// ── Cluster modal list ────────────────────────────────────────────────────────

/**
 * Renders the cluster management list inside the clusters modal.
 */
export function renderClusterList() {
  const list = document.getElementById('cluster-list');
  list.innerHTML = '';
  if (!allClusters.length) {
    list.innerHTML = '<div style="font-size:0.82rem;color:#6b7280;padding:4px 0">Keine Cluster vorhanden</div>';
    return;
  }
  allClusters.forEach(cl => {
    const col = SVC_COLORS[cl.service_type] || '#4b5563';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-bottom:1px solid #0f3460;padding:7px 0';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px';
    row.innerHTML =
      '<span style="color:' + col + ';font-size:0.9rem">◆</span>' +
      '<span style="flex:1;font-weight:500">' + escHtml(cl.name) + '</span>' +
      (cl.domain ? '<span style="font-size:0.72rem;color:#60a5fa;margin-right:4px;font-family:monospace">' + escHtml(cl.domain) + '</span>' : '') +
      '<span style="font-size:0.72rem;color:#9ca3af;margin-right:4px">' + escHtml(cl.service_type) + '</span>';
    const editBtn = document.createElement('button');
    editBtn.className = 'xs'; editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.addEventListener('click', () => toggleClusterEdit(cl.id));
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger'; delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => deleteCluster(cl.id));
    row.appendChild(editBtn); row.appendChild(delBtn);
    wrap.appendChild(row);

    if (cl.members && cl.members.length) {
      const instMap = buildInstServerMap();
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;padding-left:20px';
      cl.members.forEach(m => {
        const info = instMap[m.id];
        const srv = info ? allServers.find(s => s.id === info.serverId) : null;
        const label = srv ? srv.hostname : m.name;
        const c = document.createElement('span');
        c.className = 'chip'; c.style.background = col + '99';
        c.style.outline = '1px solid ' + col;
        c.title = m.name;
        c.innerHTML = escHtml(label) + ' <i class="fa-solid fa-xmark" style="font-size:0.6rem"></i>';
        c.onclick = () => removeClusterMember(cl.id, m.id);
        chips.appendChild(c);
      });
      wrap.appendChild(chips);
    }

    const form = document.createElement('div');
    form.id = 'cluster-edit-' + cl.id;
    form.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:6px 0 2px 4px;margin-top:4px';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap';
    nameRow.innerHTML =
      '<input type="text" id="ce-name-' + cl.id + '" value="' + escHtml(cl.name) + '" placeholder="Name" style="flex:1;min-width:100px"/>' +
      '<input type="text" id="ce-desc-' + cl.id + '" value="' + escHtml(cl.description || '') + '" placeholder="Beschreibung" style="flex:2;min-width:130px"/>' +
      '<input type="text" id="ce-domain-' + cl.id + '" value="' + escHtml(cl.domain || '') + '" placeholder="Domain / FQDN" style="flex:2;min-width:160px"/>';
    form.appendChild(nameRow);

    const memberRow = document.createElement('div');
    memberRow.style.cssText = 'display:flex;gap:5px;align-items:center;flex-wrap:wrap';
    const srvSel = document.createElement('select');
    srvSel.id = 'ce-srv-' + cl.id;
    srvSel.style.cssText = 'flex:1;font-size:0.78rem';
    [...allServers].sort((a, b) => a.hostname.localeCompare(b.hostname)).forEach(s => {
      const o = document.createElement('option'); o.value = s.id; o.textContent = s.hostname; srvSel.appendChild(o);
    });
    const instSel = document.createElement('select');
    instSel.id = 'ce-inst-' + cl.id;
    instSel.style.cssText = 'flex:2;font-size:0.78rem';
    srvSel.onchange = () => populateClusterInstSel(cl.id, parseInt(srvSel.value), cl.service_type);
    memberRow.appendChild(srvSel);
    memberRow.appendChild(instSel);
    const addMemberBtn = document.createElement('button');
    addMemberBtn.className = 'xs'; addMemberBtn.textContent = '+ Mitglied';
    addMemberBtn.onclick = () => addClusterMember(cl.id, parseInt(instSel.value));
    memberRow.appendChild(addMemberBtn);
    form.appendChild(memberRow);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:5px';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'small'; saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', () => saveClusterEdit(cl.id));
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'small'; cancelBtn.textContent = 'Abbrechen';
    cancelBtn.addEventListener('click', () => toggleClusterEdit(cl.id));
    btnRow.appendChild(saveBtn); btnRow.appendChild(cancelBtn);
    form.appendChild(btnRow);
    wrap.appendChild(form);
    list.appendChild(wrap);
  });
}

function populateClusterInstSel(clusterId, srvId, svcType) {
  const sel = document.getElementById('ce-inst-' + clusterId);
  sel.innerHTML = '';
  const srv = allServers.find(s => s.id === srvId);
  if (!srv) return;
  [...(srv.services || [])].filter(svc => svc.type === svcType).forEach(svc => {
    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const o = document.createElement('option'); o.value = inst.id; o.textContent = inst.name; sel.appendChild(o);
    });
  });
}

function toggleClusterEdit(clusterId) {
  const f = document.getElementById('cluster-edit-' + clusterId);
  if (f.style.display === 'none') {
    f.style.display = 'flex';
    const cl = allClusters.find(c => c.id === clusterId);
    const srvSel = document.getElementById('ce-srv-' + clusterId);
    if (srvSel && srvSel.value) populateClusterInstSel(clusterId, parseInt(srvSel.value), cl.service_type);
  } else {
    f.style.display = 'none';
  }
}

async function saveClusterEdit(clusterId) {
  const name        = document.getElementById('ce-name-'   + clusterId).value.trim();
  const description = document.getElementById('ce-desc-'   + clusterId).value.trim() || null;
  const domain      = document.getElementById('ce-domain-' + clusterId).value.trim() || null;
  if (!name) return alert('Name fehlt');
  try { await api('PATCH', '/clusters/' + clusterId, { name, description, domain }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderClusterList();
}

async function deleteCluster(clusterId) {
  if (!confirm('Cluster löschen?')) return;
  try { await api('DELETE', '/clusters/' + clusterId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderClusterList();
}

/**
 * Adds an instance as a member to a cluster (used by modal list).
 */
export async function addClusterMember(clusterId, instanceId) {
  if (!instanceId) return alert('Bitte Instanz auswählen');
  try { await api('POST', '/clusters/' + clusterId + '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderClusterList();
  toggleClusterEdit(clusterId);
}

/**
 * Removes an instance from a cluster (used by member chips in modal list).
 */
export async function removeClusterMember(clusterId, instanceId) {
  try { await api('DELETE', '/clusters/' + clusterId + '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  renderClusterList();
}

// ── Cluster instance relations ────────────────────────────────────────────────

/**
 * Renders the instance-relation list for the current cluster sidebar.
 */
export function renderClusterInstRelSection() {
  const cl = allClusters.find(c => c.id === currentClusterId);
  if (!cl) return;
  const instMap = buildInstServerMap();
  const srcSel = document.getElementById('cl-ir-src');
  const selectedSrcVal = srcSel && srcSel.value ? srcSel.value : null;
  const container = document.getElementById('cl-sb-inst-rels');
  container.innerHTML = '';
  const myInstIds = new Set((cl.own_instances || []).map(i => i.id));
  let rels;
  if (selectedSrcVal && selectedSrcVal.startsWith('cluster_')) {
    const cid = parseInt(selectedSrcVal.replace('cluster_', ''));
    rels = allInstanceRelations.filter(r => r.source_cluster_id === cid);
  } else if (selectedSrcVal && selectedSrcVal.startsWith('inst_')) {
    const iid = parseInt(selectedSrcVal.replace('inst_', ''));
    rels = allInstanceRelations.filter(r => r.source_instance_id === iid);
  } else {
    rels = allInstanceRelations.filter(r =>
      r.source_cluster_id === currentClusterId ||
      (r.source_instance_id && myInstIds.has(r.source_instance_id)));
  }
  rels.forEach(r => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const srcLabel = r.source_cluster_id
      ? '◆ ' + ((allClusters.find(c => c.id === r.source_cluster_id) || {}).name || '?')
      : ((instMap[r.source_instance_id] || {}).name || '?');
    const dirLabel = { to: '→', from: '←', both: '↔', none: '—' }[r.direction] || '→';
    let tgtLabel;
    if (r.target_cluster_id) tgtLabel = '◆ ' + ((allClusters.find(c => c.id === r.target_cluster_id) || {}).name || '?');
    else if (r.target_instance_id) tgtLabel = (instMap[r.target_instance_id] || {}).name || '?';
    else tgtLabel = '?';

    item.innerHTML = '<span style="font-size:0.78rem;flex:1">' + escHtml(srcLabel) +
      ' <em style="color:#6b7280">' + escHtml(r.type) + '</em> ' + dirLabel + ' ' + escHtml(tgtLabel) + '</span>';
    const editBtn = document.createElement('button');
    editBtn.className = 'xs'; editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.addEventListener('click', () => startEditInstRel(editBtn, r.id, r.type, r.direction));
    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger'; delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', () => deleteClusterInstRel(r.id));
    item.appendChild(editBtn); item.appendChild(delBtn);
    container.appendChild(item);
  });
}

/**
 * Updates the instance target dropdown when the cluster-sidebar target server changes.
 */
export function updateClusterIrTgtInst() {
  const tgtVal = document.getElementById('cl-ir-tgt-srv').value;
  const tgtInstSel = document.getElementById('cl-ir-tgt');
  tgtInstSel.innerHTML = '';
  if (!tgtVal || tgtVal.startsWith('cluster_')) { tgtInstSel.style.display = 'none'; return; }
  tgtInstSel.style.display = '';
  const tgtSrv = allServers.find(s => s.id === parseInt(tgtVal));
  if (!tgtSrv) return;
  [...(tgtSrv.services || [])].sort((a, b) => a.type.localeCompare(b.type)).forEach(svc => {
    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const o = document.createElement('option'); o.value = 'inst_' + inst.id; o.textContent = svc.type + ': ' + inst.name; tgtInstSel.appendChild(o);
    });
  });
}

async function addClusterInstRel() {
  const srcVal     = document.getElementById('cl-ir-src').value;
  const tgtSrvVal  = document.getElementById('cl-ir-tgt-srv').value;
  const tgtInstVal = document.getElementById('cl-ir-tgt').value;
  const type       = document.getElementById('cl-ir-reltype').value;
  const direction  = document.getElementById('cl-ir-direction').value;
  const payload = { type, direction };
  if (srcVal.startsWith('cluster_')) payload.source_cluster_id = parseInt(srcVal.replace('cluster_', ''));
  else payload.source_instance_id = parseInt(srcVal.replace('inst_', ''));
  if (tgtSrvVal.startsWith('cluster_')) payload.target_cluster_id = parseInt(tgtSrvVal.replace('cluster_', ''));
  else if (tgtInstVal && tgtInstVal.startsWith('inst_')) payload.target_instance_id = parseInt(tgtInstVal.replace('inst_', ''));
  else return alert('Bitte Ziel auswählen');
  if (!payload.source_cluster_id && !payload.source_instance_id) return alert('Bitte Quelle auswählen');
  try { await api('POST', '/instance-relations', payload); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function deleteClusterInstRel(relId) {
  try { await api('DELETE', '/instance-relations/' + relId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up cluster sidebar event listeners.
 */
export function initCluster() {
  document.getElementById('cl-ir-src').addEventListener('change', () => renderClusterInstRelSection());
  document.getElementById('cl-ir-tgt-srv').addEventListener('change', updateClusterIrTgtInst);
  document.getElementById('cl-sb-srv-sel').addEventListener('change', populateClusterSbInstSel);
  document.getElementById('toggle-cluster-edit-btn').addEventListener('click', toggleClusterSidebarEdit);
  document.getElementById('delete-cluster-btn').addEventListener('click', deleteCurrentCluster);
  document.getElementById('save-cluster-edit-btn').addEventListener('click', saveClusterSidebarEdit);
  document.getElementById('add-cluster-member-btn').addEventListener('click', addClusterMemberFromSidebar);
  document.getElementById('add-cluster-own-inst-btn').addEventListener('click', addClusterOwnInstance);
  document.getElementById('add-cluster-inst-rel-btn').addEventListener('click', addClusterInstRel);
}
