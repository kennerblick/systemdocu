/*
 * sidebar.js — server sidebar open/close, services section, instance management,
 *              environment/application chips, relation form, and server edit.
 * Exports: openSidebar, closeSidebar, renderServicesSection, initSidebar.
 */
'use strict';

import {
  allServers, allEnvironments, allApplications, allClusters, allRouters,
  allInstanceRelations,
  currentServerId, setCurrentServerId,
  currentClusterId, setCurrentClusterId,
  SVC_COLORS, VM_SVC_TYPES, FULL_INST_TYPES, HOST_ENV_SVC_TYPES,
  INST_ICONS, INST_SVC_TYPES,
} from './state.js';

import { api, loadAll } from './api.js';
import { escHtml, buildInstServerMap, makeInstDropdownBtn } from './utils.js';

// ── Sidebar open/close ────────────────────────────────────────────────────────

/**
 * Opens the server sidebar for the given server ID and populates all fields.
 */
export function openSidebar(serverId) {
  const server = allServers.find(s => s.id === serverId);
  if (!server) return;
  setCurrentServerId(serverId);
  setCurrentClusterId(null);
  document.getElementById('sb-edit-form').style.display = 'none';
  document.getElementById('cl-sidebar').style.display = 'none';
  document.getElementById('srv-sidebar').style.display = 'contents';
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sb-hostname').textContent = server.hostname;

  const ipEl = document.getElementById('sb-ip');
  const ips = (server.ip || '').split(',').map(s => s.trim()).filter(Boolean);
  ipEl.innerHTML = ips.length
    ? ips.map(ip => '<span style="background:#0f3460;border:1px solid #1d4ed8;border-radius:3px;padding:1px 7px;font-size:0.78rem;margin-right:3px;display:inline-block">' + escHtml(ip) + '</span>').join('')
    : '—';
  document.getElementById('sb-os').textContent = server.os_type;
  document.getElementById('sb-desc').textContent = server.description || '—';

  const gwRow = document.getElementById('sb-gw-row');
  const gwEl  = document.getElementById('sb-gw');
  let gwText = '';
  if (server.gateway_router_id) {
    const r = allRouters.find(r => r.id === server.gateway_router_id);
    if (r) gwText = r.name + (r.internal_ip ? ' (' + r.internal_ip + ')' : '');
  } else if (server.gateway_server_id) {
    const gs = allServers.find(s => s.id === server.gateway_server_id);
    if (gs) gwText = gs.hostname + ' [GW-Server]';
  }
  if (gwText) { gwEl.textContent = gwText; gwRow.style.display = ''; }
  else { gwRow.style.display = 'none'; }

  renderServicesSection(server);

  const envChips = document.getElementById('sb-envs');
  envChips.innerHTML = '';
  (server.environments || []).forEach(env => {
    const c = document.createElement('span');
    c.className = 'chip'; c.style.background = env.color;
    c.innerHTML = escHtml(env.name) + ' <i class="fa-solid fa-xmark" style="font-size:0.65rem"></i>';
    c.onclick = () => removeServerEnv(env.id);
    envChips.appendChild(c);
  });

  const relSel = document.getElementById('rel-target');
  relSel.innerHTML = '';
  [...allServers].sort((a, b) => a.hostname.localeCompare(b.hostname)).forEach(s => {
    const o = document.createElement('option'); o.value = s.id;
    o.textContent = s.hostname + (s.id === currentServerId ? ' (dieser)' : '');
    relSel.appendChild(o);
  });

  const instMap = buildInstServerMap();
  const srcSel = document.getElementById('ir-src');
  srcSel.innerHTML = '';
  const serverInstIds = new Set();
  (server.services || []).forEach(svc => (svc.instances || []).forEach(i => serverInstIds.add(i.id)));
  const relevantClusters = allClusters.filter(cl => (cl.members || []).some(m => serverInstIds.has(m.id)));
  if (relevantClusters.length) {
    const grp = document.createElement('optgroup'); grp.label = 'Cluster';
    relevantClusters.forEach(cl => {
      const o = document.createElement('option');
      o.value = 'cluster_' + cl.id;
      o.textContent = '◆ ' + cl.name + (cl.domain ? ' (' + cl.domain + ')' : ' [' + cl.service_type + ']');
      grp.appendChild(o);
    });
    srcSel.appendChild(grp);
  }
  const instGrp = document.createElement('optgroup'); instGrp.label = 'Instanzen';
  [...(server.services || [])].sort((a, b) => a.type.localeCompare(b.type)).forEach(svc => {
    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const o = document.createElement('option');
      o.value = 'inst_' + inst.id; o.textContent = svc.type + ': ' + inst.name; instGrp.appendChild(o);
    });
  });
  srcSel.appendChild(instGrp);

  const tgtSrvSel = document.getElementById('ir-tgt-srv');
  tgtSrvSel.innerHTML = '<option value="">— Cluster als Ziel —</option>';
  allClusters.forEach(cl => {
    const o = document.createElement('option');
    o.value = 'cluster_' + cl.id;
    o.textContent = '◆ ' + cl.name + (cl.domain ? ' (' + cl.domain + ')' : ' [' + cl.service_type + ']');
    tgtSrvSel.appendChild(o);
  });
  const srvGroup = document.createElement('optgroup'); srvGroup.label = 'Server';
  [...allServers].sort((a, b) => a.hostname.localeCompare(b.hostname)).forEach(s => {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.hostname; srvGroup.appendChild(o);
  });
  tgtSrvSel.appendChild(srvGroup);
  updateIrTgtInst();
  renderInstRelSection(server, instMap);

  // Show resizer
  document.getElementById('sidebar-resizer').style.display = 'block';
}

/**
 * Closes the sidebar and resets the current server/cluster selection.
 */
export function closeSidebar() {
  setCurrentServerId(null);
  setCurrentClusterId(null);
  document.getElementById('cl-sidebar').style.display = 'none';
  document.getElementById('srv-sidebar').style.display = 'contents';
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-resizer').style.display = 'none';
}

// ── Services section ──────────────────────────────────────────────────────────

/**
 * Renders the full services & instances section inside the server sidebar.
 */
export function renderServicesSection(server) {
  const container = document.getElementById('sb-services');
  container.innerHTML = '';
  [...(server.services || [])].sort((a, b) => a.type.localeCompare(b.type)).forEach(svc => {
    const block = document.createElement('div');
    block.className = 'svc-block';

    const hdr = document.createElement('div');
    hdr.className = 'svc-header';
    const col = SVC_COLORS[svc.type] || '#4b5563';
    hdr.innerHTML = '<span class="svc-title" style="color:' + col + '">' +
      svc.type + (svc.version ? ' ' + svc.version : '') + (svc.port ? ':' + svc.port : '') +
      '</span>';

    const siblings = (server.services || []).filter(s => s.type === svc.type && s.id !== svc.id);
    if (siblings.length) {
      const mergeBtn = document.createElement('button');
      mergeBtn.className = 'xs';
      mergeBtn.title = 'Instanzen in den anderen ' + svc.type + '-Service verschieben und diesen löschen';
      mergeBtn.innerHTML = '<i class="fa-solid fa-code-merge"></i> Zusammenführen';
      mergeBtn.style.color = '#fbbf24';
      mergeBtn.onclick = () => mergeService(svc.id, siblings[0].id, svc.instances || []);
      hdr.appendChild(mergeBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'xs danger';
    delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.onclick = () => deleteService(svc.id);
    hdr.appendChild(delBtn);
    block.appendChild(hdr);

    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const row = document.createElement('div');
      row.className = 'instance-row';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'instance-name';
      nameDiv.style.display = 'flex'; nameDiv.style.alignItems = 'center';
      nameDiv.style.gap = '5px'; nameDiv.style.flexWrap = 'wrap';
      nameDiv.innerHTML = escHtml(inst.name) +
        (inst.description ? ' <span style="color:#6b7280;font-size:0.72rem">— ' + escHtml(inst.description) + '</span>' : '');

      const instDelBtn = document.createElement('button');
      instDelBtn.className = 'xs danger';
      instDelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      instDelBtn.onclick = () => deleteInstance(inst.id);

      if (VM_SVC_TYPES.has(svc.type)) {
        const ipInp = document.createElement('input');
        ipInp.type = 'text'; ipInp.value = inst.ip || ''; ipInp.placeholder = 'IP(s) kommagetrennt';
        ipInp.style.cssText = 'width:115px;font-size:0.72rem;padding:1px 5px';
        ipInp.title = 'IPs dieser VM (kommagetrennt)';
        const ipBtn = document.createElement('button');
        ipBtn.className = 'xs'; ipBtn.textContent = '+IP';
        ipBtn.onclick = () => updateInstanceIp(inst.id, ipInp.value || null);
        const ipWrap = document.createElement('div');
        ipWrap.style.cssText = 'display:flex;gap:3px;align-items:center;margin-left:auto';
        ipWrap.appendChild(ipInp); ipWrap.appendChild(ipBtn);
        nameDiv.appendChild(ipWrap);

        const gwSel = document.createElement('select');
        gwSel.style.cssText = 'max-width:140px;font-size:0.72rem;padding:1px 4px';
        gwSel.title = 'Gateway dieser VM';
        gwSel.innerHTML = '<option value="">— kein GW —</option>';
        const instEnvIds = new Set((inst.environments || []).map(e => e.id));
        const allGwInsts = [];
        allServers.forEach(sv => (sv.services || []).forEach(sv2 => (sv2.instances || []).forEach(i2 => {
          if (i2.is_gateway && i2.id !== inst.id) allGwInsts.push(i2);
        })));
        const matchedRouters  = allRouters.filter(r => (r.environments || []).some(e => instEnvIds.has(e.id)));
        const otherRouters    = allRouters.filter(r => !(r.environments || []).some(e => instEnvIds.has(e.id)));
        const matchedGwSrvs   = allServers.filter(gs => gs.is_gateway && (gs.environments || []).some(e => instEnvIds.has(e.id)));
        const otherGwSrvs     = allServers.filter(gs => gs.is_gateway && !(gs.environments || []).some(e => instEnvIds.has(e.id)));
        const matchedGwInsts  = allGwInsts.filter(i2 => (i2.environments || []).some(e => instEnvIds.has(e.id)));
        const otherGwInsts    = allGwInsts.filter(i2 => !(i2.environments || []).some(e => instEnvIds.has(e.id)));

        const addRouterOpt = r => {
          const opt = document.createElement('option');
          opt.value = 'router_' + r.id;
          opt.textContent = r.name + (r.internal_ip ? ' (' + r.internal_ip + ')' : '');
          if (inst.gateway_router_id === r.id) opt.selected = true;
          gwSel.appendChild(opt);
        };
        const addServerOpt = gs => {
          const opt = document.createElement('option');
          opt.value = 'server_' + gs.id;
          opt.textContent = gs.hostname + ' [GW-Server]';
          if (inst.gateway_server_id === gs.id) opt.selected = true;
          gwSel.appendChild(opt);
        };
        const addInstOpt = i2 => {
          const opt = document.createElement('option');
          opt.value = 'instance_' + i2.id;
          opt.textContent = i2.name + ' [GW-VM]';
          if (inst.gateway_instance_id === i2.id) opt.selected = true;
          gwSel.appendChild(opt);
        };
        const addSep = label => {
          const sep = document.createElement('option');
          sep.disabled = true; sep.textContent = '── ' + label + ' ──';
          gwSel.appendChild(sep);
        };
        const hasMatched = matchedRouters.length || matchedGwSrvs.length || matchedGwInsts.length;
        const hasOther   = otherRouters.length  || otherGwSrvs.length   || otherGwInsts.length;
        if (hasMatched) {
          if (hasOther) addSep('Selbe Umgebung');
          matchedRouters.forEach(addRouterOpt);
          matchedGwSrvs.forEach(addServerOpt);
          matchedGwInsts.forEach(addInstOpt);
          if (hasOther) {
            addSep('Andere Umgebungen');
            otherRouters.forEach(addRouterOpt);
            otherGwSrvs.forEach(addServerOpt);
            otherGwInsts.forEach(addInstOpt);
          }
        } else {
          allRouters.forEach(addRouterOpt);
          allServers.filter(gs => gs.is_gateway).forEach(addServerOpt);
          allGwInsts.forEach(addInstOpt);
        }
        gwSel.onchange = () => {
          const v = gwSel.value;
          updateInstanceGateway(inst.id,
            v.startsWith('router_')   ? parseInt(v.replace('router_', ''))   : null,
            v.startsWith('server_')   ? parseInt(v.replace('server_', ''))   : null,
            v.startsWith('instance_') ? parseInt(v.replace('instance_', '')) : null);
        };
        nameDiv.appendChild(gwSel);
      } else {
        instDelBtn.style.marginLeft = 'auto';
      }
      nameDiv.appendChild(instDelBtn);
      row.appendChild(nameDiv);

      // Environment + application chips
      const chipRow = document.createElement('div');
      chipRow.className = 'instance-chips';
      (inst.environments || []).forEach(env => {
        const c = document.createElement('span');
        c.className = 'chip'; c.style.background = env.color;
        c.style.outline = '1px solid rgba(255,255,255,0.3)';
        c.innerHTML = '🌍 ' + escHtml(env.name) + ' <i class="fa-solid fa-xmark" style="font-size:0.6rem"></i>';
        c.onclick = () => removeInstanceEnv(inst.id, env.id);
        chipRow.appendChild(c);
      });
      (inst.applications || []).forEach(app => {
        const c = document.createElement('span');
        c.className = 'chip'; c.style.background = app.color;
        c.innerHTML = app.name + ' <i class="fa-solid fa-xmark" style="font-size:0.6rem"></i>';
        c.onclick = () => removeInstanceApp(inst.id, app.id);
        chipRow.appendChild(c);
      });
      row.appendChild(chipRow);

      // Own services list
      if ((inst.own_services || []).length) {
        const ownSvcDiv = document.createElement('div');
        ownSvcDiv.style.cssText = 'padding:3px 0 3px 8px;border-left:2px solid #1d4ed8;margin:2px 0 0 4px;display:flex;flex-direction:column;gap:3px';
        (inst.own_services || []).forEach(isvc => {
          const isvcRow = document.createElement('div');
          isvcRow.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:0.75rem';
          const c = SVC_COLORS[isvc.type] || '#4b5563';
          isvcRow.innerHTML = '<span style="color:' + c + '">' + (INST_ICONS[isvc.type] || '⚙') + ' ' +
            escHtml(isvc.type) + (isvc.version ? ' ' + escHtml(isvc.version) : '') +
            (isvc.port ? ':<b>' + isvc.port + '</b>' : '') + '</span>';
          const rmBtn = document.createElement('button');
          rmBtn.className = 'xs danger'; rmBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
          rmBtn.onclick = () => deleteInstanceService(inst.id, isvc.id);
          isvcRow.appendChild(rmBtn);
          ownSvcDiv.appendChild(isvcRow);
        });
        row.appendChild(ownSvcDiv);
      }

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'margin-top:4px;display:flex;flex-direction:column;gap:3px';

      if (VM_SVC_TYPES.has(svc.type)) {
        const gwChkRow = document.createElement('div');
        gwChkRow.style.cssText = 'display:flex;gap:5px;align-items:center';
        const gwChk = document.createElement('input');
        gwChk.type = 'checkbox'; gwChk.checked = !!inst.is_gateway;
        gwChk.onchange = () => api('PATCH', '/instances/' + inst.id, { is_gateway: gwChk.checked }).then(() => loadAll());
        const gwChkLbl = document.createElement('label');
        gwChkLbl.style.cssText = 'font-size:0.72rem;color:#9ca3af;cursor:pointer;display:flex;gap:4px;align-items:center';
        gwChkLbl.appendChild(gwChk);
        gwChkLbl.appendChild(document.createTextNode('fungiert als Gateway'));
        gwChkRow.appendChild(gwChkLbl);
        actionsDiv.appendChild(gwChkRow);
      }

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center';

      if (FULL_INST_TYPES.has(svc.type)) {
        if (allEnvironments.length) {
          const assignedEnvIds = new Set((inst.environments || []).map(e => e.id));
          btnRow.appendChild(makeInstDropdownBtn('Netzwerk',
            () => allEnvironments.filter(e => !assignedEnvIds.has(e.id)).map(e => ({ id: e.id, label: e.name, color: e.color })),
            id => addInstanceEnv(inst.id, id), 'Alle Netzwerke bereits vergeben'));
        }
        if (allApplications.length) {
          const assignedAppIds = new Set((inst.applications || []).map(a => a.id));
          btnRow.appendChild(makeInstDropdownBtn('Anwendung',
            () => allApplications.filter(a => !assignedAppIds.has(a.id)).map(a => ({ id: a.id, label: a.name, color: a.color })),
            id => addInstanceApp(inst.id, id), 'Alle Anwendungen bereits vergeben'));
        }
        btnRow.appendChild(makeInstDropdownBtn('Service',
          INST_SVC_TYPES.map(t => ({ id: t, label: (INST_ICONS[t] || '⚙') + ' ' + t })),
          t => addInstanceService(inst.id, t, null, null), 'Keine Dienste verfügbar'));
      } else {
        if (allApplications.length) {
          const assignedAppIds = new Set((inst.applications || []).map(a => a.id));
          btnRow.appendChild(makeInstDropdownBtn('Anwendung',
            () => allApplications.filter(a => !assignedAppIds.has(a.id)).map(a => ({ id: a.id, label: a.name, color: a.color })),
            id => addInstanceApp(inst.id, id), 'Alle Anwendungen bereits vergeben'));
        }
      }

      if (btnRow.children.length) actionsDiv.appendChild(btnRow);
      row.appendChild(actionsDiv);

      // Inline instance relation summary
      const instRels = allInstanceRelations.filter(r =>
        r.source_instance_id === inst.id || r.target_instance_id === inst.id);
      if (instRels.length) {
        const relDiv = document.createElement('div');
        relDiv.style.cssText = 'margin-top:4px;display:flex;flex-direction:column;gap:2px';
        instRels.forEach(r => {
          const isSrc = r.source_instance_id === inst.id;
          const otherId = isSrc ? r.target_instance_id : r.source_instance_id;
          const otherClId = isSrc ? r.target_cluster_id : r.source_cluster_id;
          let otherName = '?', otherServerName = '';
          if (otherId) {
            allServers.forEach(sv => (sv.services || []).forEach(sv2 => (sv2.instances || []).forEach(i2 => {
              if (i2.id === otherId) { otherName = i2.name; otherServerName = sv.hostname; }
            })));
          } else if (otherClId) {
            const cl = allClusters.find(c => c.id === otherClId);
            if (cl) otherName = cl.name;
          }
          const arrow = r.direction === 'from' ? (isSrc ? '←' : '→') : (isSrc ? '→' : '←');
          const relRow = document.createElement('div');
          relRow.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:0.72rem;color:#9ca3af';
          relRow.innerHTML = '<span style="color:#7c3aed;font-weight:600">' + arrow + '</span>' +
            (otherServerName ? '<span style="color:#6b7280">' + escHtml(otherServerName) + '/</span>' : '') +
            escHtml(otherName) +
            '<span style="color:#4b5563">(' + escHtml(r.type) + ')</span>';
          relDiv.appendChild(relRow);
        });
        row.appendChild(relDiv);
      }

      block.appendChild(row);
    });

    const addRow = document.createElement('div');
    addRow.className = 'add-instance-form';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.placeholder = 'Instanzname...';
    const descInput = document.createElement('input');
    descInput.type = 'text'; descInput.placeholder = 'Beschreibung'; descInput.style.width = '100px';
    const addBtn = document.createElement('button');
    addBtn.className = 'xs'; addBtn.textContent = '+ Instanz';
    addBtn.onclick = () => addInstance(svc.id, nameInput.value, descInput.value, svc.type, server);
    addRow.appendChild(nameInput);
    addRow.appendChild(descInput);
    addRow.appendChild(addBtn);
    block.appendChild(addRow);

    container.appendChild(block);
  });
}

// ── Instance relation section ─────────────────────────────────────────────────

/**
 * Renders the instance-relation list for the current server (filtered by ir-src selection).
 */
export function renderInstRelSection(server, instMap) {
  if (!server) server = allServers.find(s => s.id === currentServerId);
  if (!server) return;
  instMap = instMap || buildInstServerMap();
  const myInstIds = new Set();
  (server.services || []).forEach(svc => (svc.instances || []).forEach(i => myInstIds.add(i.id)));
  const srcSel = document.getElementById('ir-src');
  const selectedSrcVal = srcSel && srcSel.value ? srcSel.value : null;
  const container = document.getElementById('sb-inst-rels');
  container.innerHTML = '';

  let rels;
  if (selectedSrcVal && selectedSrcVal.startsWith('cluster_')) {
    const cid = parseInt(selectedSrcVal.replace('cluster_', ''));
    rels = allInstanceRelations.filter(r => r.source_cluster_id === cid);
  } else if (selectedSrcVal && selectedSrcVal.startsWith('inst_')) {
    const iid = parseInt(selectedSrcVal.replace('inst_', ''));
    rels = allInstanceRelations.filter(r => r.source_instance_id === iid);
  } else {
    rels = allInstanceRelations.filter(r =>
      myInstIds.has(r.source_instance_id) ||
      allClusters.some(cl => cl.id === r.source_cluster_id && (cl.members || []).some(m => myInstIds.has(m.id))));
  }

  if (!rels.length) {
    container.innerHTML = '<div style="font-size:0.78rem;color:#6b7280">Keine</div>';
    return;
  }
  rels.forEach(r => {
    const src = r.source_instance_id ? instMap[r.source_instance_id] : null;
    const tgt = r.target_instance_id ? instMap[r.target_instance_id] : null;
    const srcCl = r.source_cluster_id ? allClusters.find(c => c.id === r.source_cluster_id) : null;
    const tgtCl = r.target_cluster_id ? allClusters.find(c => c.id === r.target_cluster_id) : null;
    const srcSrv = src ? allServers.find(s => s.id === src.serverId) : null;
    const tgtSrv = tgt ? allServers.find(s => s.id === tgt.serverId) : null;
    const row = document.createElement('div');
    row.className = 'list-item';
    row.style.fontSize = '0.78rem';
    const dir = r.direction || 'to';
    const dirIcon = dir === 'both' ? '↔' : dir === 'none' ? '—' : dir === 'from' ? '←' : '→';
    const srcLabel = escHtml(srcCl ? '◆ ' + srcCl.name : (src ? src.name + ' (' + (srcSrv ? srcSrv.hostname : '?') + ')' : '?'));
    const tgtLabel = escHtml(tgtCl ? '◆ ' + tgtCl.name : (tgt ? tgt.name + ' (' + (tgtSrv ? tgtSrv.hostname : '?') + ')' : '?'));
    row.innerHTML =
      '<span style="color:#a78bfa;flex:1">' + srcLabel +
      ' <span style="color:#94a3b8">' + dirIcon + '</span> ' + tgtLabel +
      '</span><span style="color:#6b7280;margin:0 4px;font-size:0.72rem">' + escHtml(r.type) + '</span>' +
      '<button class="xs" data-edit-rel="' + r.id + '" data-rel-type="' + escHtml(r.type) + '" data-rel-dir="' + dir + '" title="Bearbeiten"><i class="fa-solid fa-pen"></i></button>' +
      '<button class="xs danger" data-del-rel="' + r.id + '"><i class="fa-solid fa-xmark"></i></button>';
    container.appendChild(row);
  });

  // Attach event listeners to avoid inline onclick
  container.querySelectorAll('[data-edit-rel]').forEach(btn => {
    btn.addEventListener('click', () => startEditInstRel(btn, parseInt(btn.dataset.editRel), btn.dataset.relType, btn.dataset.relDir));
  });
  container.querySelectorAll('[data-del-rel]').forEach(btn => {
    btn.addEventListener('click', () => deleteInstRel(parseInt(btn.dataset.delRel)));
  });
}

/**
 * Populates the instance target dropdown when the target server changes.
 */
export function updateIrTgtInst() {
  const tgtVal = document.getElementById('ir-tgt-srv').value;
  const tgtInstSel = document.getElementById('ir-tgt');
  tgtInstSel.innerHTML = '';
  if (!tgtVal || tgtVal.startsWith('cluster_')) { tgtInstSel.style.display = 'none'; return; }
  tgtInstSel.style.display = '';
  const tgtSrvId = parseInt(tgtVal);
  const tgtSrv = allServers.find(s => s.id === tgtSrvId);
  if (!tgtSrv) return;
  [...(tgtSrv.services || [])].sort((a, b) => a.type.localeCompare(b.type)).forEach(svc => {
    [...(svc.instances || [])].sort((a, b) => a.name.localeCompare(b.name)).forEach(inst => {
      const o = document.createElement('option');
      o.value = 'inst_' + inst.id; o.textContent = svc.type + ': ' + inst.name; tgtInstSel.appendChild(o);
    });
  });
}

/** Puts an instance-relation row into inline edit mode. */
export function startEditInstRel(btn, relId, currentType, currentDir) {
  const row = btn.closest('.list-item');
  row.innerHTML =
    '<select style="font-size:0.75rem;width:95px" id="ire-type-' + relId + '">' +
    ['connects_to', 'uses', 'depends_on', 'hosts'].map(t =>
      '<option' + (t === currentType ? ' selected' : '') + '>' + t + '</option>').join('') +
    '</select>' +
    '<select style="font-size:0.75rem;width:48px" id="ire-dir-' + relId + '">' +
    [['to', '→'], ['from', '←'], ['both', '↔'], ['none', '—']].map(([v, l]) =>
      '<option value="' + v + '"' + (v === currentDir ? ' selected' : '') + '>' + l + '</option>').join('') +
    '</select>' +
    '<button class="xs" data-save-rel="' + relId + '"><i class="fa-solid fa-check"></i></button>' +
    '<button class="xs" data-cancel-rel="1"><i class="fa-solid fa-xmark"></i></button>';
  row.querySelector('[data-save-rel]').addEventListener('click', () => saveEditInstRel(relId));
  row.querySelector('[data-cancel-rel]').addEventListener('click', () => renderInstRelSection());
}

async function saveEditInstRel(relId) {
  const type      = document.getElementById('ire-type-' + relId).value;
  const direction = document.getElementById('ire-dir-'  + relId).value;
  try { await api('PATCH', '/instance-relations/' + relId, { type, direction }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function addInstRel() {
  const srcVal     = document.getElementById('ir-src').value;
  const tgtSrvVal  = document.getElementById('ir-tgt-srv').value;
  const tgtInstVal = document.getElementById('ir-tgt').value;
  const type       = document.getElementById('ir-reltype').value;
  const direction  = document.getElementById('ir-direction').value;

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

async function deleteInstRel(relId) {
  try { await api('DELETE', '/instance-relations/' + relId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

// ── Server edit ───────────────────────────────────────────────────────────────

/** Toggles the inline server-edit form and populates its fields. */
export function toggleServerEdit() {
  const form = document.getElementById('sb-edit-form');
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : 'flex';
  if (!visible) {
    const s = allServers.find(s => s.id === currentServerId);
    if (!s) return;
    document.getElementById('edit-hostname').value = s.hostname || '';
    document.getElementById('edit-ip').value = s.ip || '';
    document.getElementById('edit-os').value = s.os_type || 'linux';
    document.getElementById('edit-desc').value = s.description || '';
    document.getElementById('edit-is-gateway').checked = s.is_gateway || false;
    const gwSel = document.getElementById('edit-gateway-device');
    gwSel.innerHTML = '<option value="">— kein Gateway —</option>';
    const envIds = new Set((s.environments || []).map(e => e.id));
    allRouters.forEach(r => {
      if ((r.environments || []).some(e => envIds.has(e.id))) {
        const opt = document.createElement('option');
        opt.value = 'router_' + r.id;
        opt.textContent = r.name + (r.internal_ip ? ' (' + r.internal_ip + ')' : '');
        if (s.gateway_router_id === r.id) opt.selected = true;
        gwSel.appendChild(opt);
      }
    });
    allServers.forEach(gs => {
      if (gs.id === s.id || !gs.is_gateway) return;
      if ((gs.environments || []).some(e => envIds.has(e.id))) {
        const opt = document.createElement('option');
        opt.value = 'server_' + gs.id;
        opt.textContent = gs.hostname + (gs.ip ? ' (' + gs.ip + ')' : '') + ' [GW-Server]';
        if (s.gateway_server_id === gs.id) opt.selected = true;
        gwSel.appendChild(opt);
      }
    });
  }
}

/**
 * Saves the server edit form and reloads.
 */
export async function saveServerEdit() {
  try {
    const gwVal = document.getElementById('edit-gateway-device').value;
    await api('PUT', '/servers/' + currentServerId, {
      hostname:          document.getElementById('edit-hostname').value.trim() || undefined,
      ip:                document.getElementById('edit-ip').value || null,
      os_type:           document.getElementById('edit-os').value,
      description:       document.getElementById('edit-desc').value || null,
      is_gateway:        document.getElementById('edit-is-gateway').checked,
      gateway_router_id: gwVal.startsWith('router_') ? parseInt(gwVal.replace('router_', '')) : null,
      gateway_server_id: gwVal.startsWith('server_') ? parseInt(gwVal.replace('server_', '')) : null,
    });
  } catch (e) { return alert('Fehler: ' + e.message); }
  document.getElementById('sb-edit-form').style.display = 'none';
  await loadAll();
}

/**
 * Deletes the currently open server after confirmation.
 */
export async function deleteCurrentServer() {
  if (!confirm('Server wirklich löschen?')) return;
  try { await api('DELETE', '/servers/' + currentServerId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  closeSidebar();
  await loadAll();
}

/** Toggles the add-service form visibility. */
export function toggleAddService() {
  const f = document.getElementById('add-service-form');
  f.style.display = f.style.display === 'none' ? 'flex' : 'none';
}

/**
 * Creates a new service for the current server.
 */
export async function addService() {
  const type    = document.getElementById('svc-type').value;
  const version = document.getElementById('svc-version').value || null;
  const port    = parseInt(document.getElementById('svc-port').value) || null;
  try { await api('POST', '/servers/' + currentServerId + '/services', { type, version, port }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
  document.getElementById('add-service-form').style.display = 'none';
}

async function deleteService(serviceId) {
  if (!confirm('Service und alle Instanzen löschen?')) return;
  try { await api('DELETE', '/services/' + serviceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function mergeService(sourceId, targetId, instances) {
  const n = instances.length;
  if (!confirm('Alle ' + n + ' Instanz(en) aus diesem Service in den anderen verschieben und diesen Service danach löschen?\n\nKeine Daten gehen verloren.')) return;
  try {
    for (const inst of instances) await api('PATCH', '/instances/' + inst.id, { service_id: targetId });
    await api('DELETE', '/services/' + sourceId);
  } catch (e) { return alert('Fehler beim Zusammenführen: ' + e.message); }
  await loadAll();
}

// ── Instance CRUD ─────────────────────────────────────────────────────────────

async function addInstance(serviceId, name, description, svcType, server) {
  name = name.trim();
  if (!name) return alert('Instanzname fehlt');
  try {
    const inst = await api('POST', '/services/' + serviceId + '/instances', { name, description: description || null });
    if (inst && svcType && HOST_ENV_SVC_TYPES.has(svcType) && server) {
      for (const env of (server.environments || [])) {
        try { await api('POST', '/instances/' + inst.id + '/environments/' + env.id); } catch (e) {}
      }
    }
  } catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function deleteInstance(instanceId) {
  try { await api('DELETE', '/instances/' + instanceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function addInstanceEnv(instanceId, envId) {
  try { await api('POST', '/instances/' + instanceId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function removeInstanceEnv(instanceId, envId) {
  try { await api('DELETE', '/instances/' + instanceId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function addInstanceApp(instanceId, appId) {
  try { await api('POST', '/instances/' + instanceId + '/applications/' + appId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function removeInstanceApp(instanceId, appId) {
  try { await api('DELETE', '/instances/' + instanceId + '/applications/' + appId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function updateInstanceIp(instanceId, ip) {
  try { await api('PATCH', '/instances/' + instanceId, { ip: ip || null }); }
  catch (e) { return alert('Fehler beim Speichern der IP: ' + e.message); }
  await loadAll();
}

async function addInstanceService(instanceId, type, version, port) {
  try { await api('POST', '/instances/' + instanceId + '/services', { type, version: version || null, port: parseInt(port) || null }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function deleteInstanceService(instanceId, serviceId) {
  try { await api('DELETE', '/instances/' + instanceId + '/services/' + serviceId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function updateInstanceGateway(instanceId, gateway_router_id, gateway_server_id, gateway_instance_id) {
  try {
    await api('PATCH', '/instances/' + instanceId, {
      gateway_router_id:   gateway_router_id   || null,
      gateway_server_id:   gateway_server_id   || null,
      gateway_instance_id: gateway_instance_id || null,
    });
  } catch (e) { return alert('Fehler beim Speichern des Gateways: ' + e.message); }
  await loadAll();
}

// ── Environment / relation helpers ────────────────────────────────────────────

/**
 * Toggles the environment-assignment dropdown for the current server.
 */
export function toggleEnvDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('env-dropdown');
  if (dd.style.display !== 'none') { dd.style.display = 'none'; return; }

  const server = allServers.find(s => s.id === currentServerId);
  const assignedIds = new Set((server?.environments || []).map(e => e.id));
  const available = allEnvironments.filter(e => !assignedIds.has(e.id));

  dd.innerHTML = '';
  if (!available.length) {
    dd.innerHTML = '<div style="padding:8px 12px;font-size:0.8rem;color:#6b7280">Keine weiteren Umgebungen</div>';
  } else {
    available.forEach(env => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;gap:8px';
      item.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:${env.color};display:inline-block;flex-shrink:0"></span>${escHtml(env.name)}`;
      item.onmouseenter = () => item.style.background = '#334155';
      item.onmouseleave = () => item.style.background = '';
      item.onclick = () => { dd.style.display = 'none'; assignServerEnv(env.id); };
      dd.appendChild(item);
    });
  }
  dd.style.display = 'block';
}

/**
 * Assigns an environment to the current server.
 */
export async function assignServerEnv(envId) {
  if (!envId) return;
  try { await api('POST', '/servers/' + currentServerId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

async function removeServerEnv(envId) {
  try { await api('DELETE', '/servers/' + currentServerId + '/environments/' + envId); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

/**
 * Adds a server-to-server relation from the sidebar relation form.
 */
export async function addRelation() {
  const target_id = parseInt(document.getElementById('rel-target').value);
  const type = document.getElementById('rel-type').value;
  if (!target_id) return;
  try { await api('POST', '/relations', { source_id: currentServerId, target_id, type }); }
  catch (e) { return alert('Fehler: ' + e.message); }
  await loadAll();
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires up all sidebar-related button event listeners.
 */
export function initSidebar() {
  document.getElementById('ir-src').addEventListener('change', () => renderInstRelSection());
  document.getElementById('ir-tgt-srv').addEventListener('change', updateIrTgtInst);
  document.getElementById('env-add-btn').addEventListener('click', toggleEnvDropdown);

  // Close env dropdown when clicking elsewhere
  document.addEventListener('click', () => {
    const dd = document.getElementById('env-dropdown');
    if (dd) dd.style.display = 'none';
  });

  document.getElementById('toggle-server-edit-btn').addEventListener('click', toggleServerEdit);
  document.getElementById('delete-server-btn').addEventListener('click', deleteCurrentServer);
  document.getElementById('save-server-edit-btn').addEventListener('click', saveServerEdit);
  document.getElementById('toggle-add-service-btn').addEventListener('click', toggleAddService);
  document.getElementById('add-service-save-btn').addEventListener('click', addService);
  document.getElementById('add-rel-btn').addEventListener('click', addRelation);
  document.getElementById('add-inst-rel-btn').addEventListener('click', addInstRel);
}
