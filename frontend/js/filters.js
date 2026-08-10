/*
 * filters.js — environment/application filter logic.
 * Exports: applyFilters, updateFilters, initFilters.
 */
'use strict';

import {
  allServers, allEnvironments, allApplications, allClusters, allRouters,
  allInstanceRelations,
  network, nodes, edges,
  layoutMode,
  inetNodeIds, inetEdgeIds,
  showInternet,
  showingInstances,
  hiddenByFilter, setHiddenByFilter,
  isExternServer,
} from './state.js';

import { computeHierarchicalPositions, fitVisible } from './graph.js';

/**
 * Populates the environment and application filter dropdowns from current data.
 */
export function updateFilters() {
  function syncSel(selId, items, labelKey) {
    const sel = document.getElementById(selId);
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle</option>';
    items.forEach(it => {
      const o = document.createElement('option');
      o.value = it.id; o.textContent = it[labelKey]; sel.appendChild(o);
    });
    sel.value = cur;
  }
  syncSel('env-filter', allEnvironments, 'name');
  syncSel('app-filter', allApplications, 'name');
}

/**
 * Shows/hides the "N von M Server sichtbar" badge and reset button, and
 * highlights the filter bar while a filter is active.
 */
function _updateFilterStatus(active, visibleCount, totalCount) {
  const bar    = document.getElementById('filter-bar');
  const status = document.getElementById('filter-status');
  const reset  = document.getElementById('filter-reset-btn');
  if (!bar || !status || !reset) return;
  bar.classList.toggle('active', !!active);
  status.style.display = active ? '' : 'none';
  reset.style.display  = active ? '' : 'none';
  if (active) status.textContent = visibleCount + ' von ' + totalCount + ' Servern';
  _updateEmptyHint(active && visibleCount === 0 && totalCount > 0);
}

/** Shows/hides the "no matches" overlay in the graph area when a filter matches nothing. */
function _updateEmptyHint(show) {
  const graphEl = document.getElementById('graph');
  if (!graphEl) return;
  let hint = document.getElementById('filter-empty-hint');
  if (show && !hint) {
    hint = document.createElement('div');
    hint.id = 'filter-empty-hint';
    hint.innerHTML = '<i class="fa-solid fa-filter-circle-xmark"></i><span>Keine Server entsprechen dem aktuellen Filter</span>';
    graphEl.appendChild(hint);
  }
  if (hint) hint.style.display = show ? 'flex' : 'none';
}

/**
 * Clears both filter dropdowns and re-applies (i.e. resets) the filter.
 */
export function resetFilters() {
  document.getElementById('env-filter').value = '';
  document.getElementById('app-filter').value = '';
  applyFilters();
}

/**
 * Applies the current env/app filter selection to show/hide nodes and edges.
 */
export function applyFilters(skipFit = false) {
  if (!nodes || !edges || !network) return;
  const envId = parseInt(document.getElementById('env-filter').value) || 0;
  const appId = parseInt(document.getElementById('app-filter').value) || 0;
  const isFiltered = envId || appId;
  const nodeUpdates = [], edgeUpdates = [];

  if (!isFiltered) {
    _updateFilterStatus(false, 0, allServers.length);
    setHiddenByFilter(new Set());
    allServers.forEach(s => {
      const hideExt = isExternServer(s) && !showInternet;
      nodeUpdates.push({ id: s.id, hidden: hideExt, physics: !hideExt });
      (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
        if (nodes.get('inst_' + inst.id)) nodeUpdates.push({ id: 'inst_' + inst.id, hidden: hideExt, physics: !hideExt });
        if (edges.get('si_'  + inst.id)) edgeUpdates.push({ id: 'si_'  + inst.id, hidden: hideExt });
      }));
    });
    allClusters.forEach(cl => {
      if (nodes.get('cluster_' + cl.id)) nodeUpdates.push({ id: 'cluster_' + cl.id, hidden: false, physics: true });
    });
    allEnvironments.forEach(env => {
      if (nodes.get('switch_' + env.id)) nodeUpdates.push({ id: 'switch_' + env.id, hidden: false, physics: true });
    });
    inetNodeIds.forEach(id => { if (nodes.get(id)) nodeUpdates.push({ id, hidden: !showInternet, physics: showInternet }); });
    edges.forEach(e => {
      const id = e.id;
      if (typeof id !== 'string') return;
      if (inetEdgeIds.includes(id)) { edgeUpdates.push({ id, hidden: !showInternet }); return; }
      if (id.startsWith('inet_extern_')) { edgeUpdates.push({ id, hidden: !showInternet }); return; }
      if (id.startsWith('gw_srv_') || id.startsWith('gw_inst_')) {
        const needsInternet = typeof e.from === 'string' && e.from.startsWith('router_');
        edgeUpdates.push({ id, hidden: needsInternet && !showInternet });
      } else if (id.startsWith('ir_srv_')) {
        edgeUpdates.push({ id, hidden: showingInstances });
      } else if (!id.startsWith('si_')) {
        edgeUpdates.push({ id, hidden: false });
      }
    });
    nodes.update(nodeUpdates);
    edges.update(edgeUpdates);
    if (layoutMode === 'hierarchical') {
      const pos = computeHierarchicalPositions();
      Object.entries(pos).forEach(([id, { x, y }]) => {
        const nid = isNaN(Number(id)) ? id : Number(id);
        const bn = network.body.nodes[nid];
        if (bn) { bn.x = x; bn.y = y; }
      });
    }
    if (!skipFit) {
      fitVisible();
      if (layoutMode !== 'hierarchical') network.stabilize(150);
    }
    network.redraw();
    return;
  }

  // ── 1. Matching instance IDs ──────────────────────────────────────────────
  // An Application assigned to a Server as a whole is inherited by every
  // Instance on that server for filtering purposes — but only if that
  // assignment opted into inherit_to_instances (see inherited_application_ids).
  const matchingInstIds = new Set();
  allServers.forEach(s => {
    const srvHasApp = appId && (s.inherited_application_ids || []).includes(appId);
    (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      let ok = true;
      if (envId && !(inst.environments || []).some(e => e.id === envId)) ok = false;
      if (appId && !srvHasApp && !(inst.applications || []).some(a => a.id === appId)) ok = false;
      if (ok) matchingInstIds.add(inst.id);
    }));
  });

  // ── 2. Visible servers ────────────────────────────────────────────────────
  const visibleSrvIds = new Set();
  allServers.forEach(s => {
    const hasMatchingInst = (s.services || []).some(svc =>
      (svc.instances || []).some(inst => matchingInstIds.has(inst.id)));
    const bareInEnv = envId && !appId && (s.environments || []).some(e => e.id === envId) &&
      !(s.services || []).some(svc => (svc.instances || []).length > 0);
    // A server assigned directly to the selected application (as a whole,
    // not via one of its instances) is visible regardless of whether it
    // has instances — and must still satisfy an active env filter itself.
    const srvAppMatch = appId && (s.applications || []).some(a => a.id === appId) &&
      (!envId || (s.environments || []).some(e => e.id === envId));
    if (hasMatchingInst || bareInEnv || srvAppMatch) visibleSrvIds.add(s.id);
  });

  // A Server used as the gateway (GW-Server) of an already-visible server or
  // instance must stay visible too, even though it carries none of the
  // filtered env/app tags itself — it can itself point at a further GW-Server,
  // so resolve the whole chain.
  let addedGwSrv = true;
  while (addedGwSrv) {
    addedGwSrv = false;
    const neededGwSrvIds = new Set();
    allServers.forEach(s => {
      if (visibleSrvIds.has(s.id) && s.gateway_server_id) neededGwSrvIds.add(s.gateway_server_id);
      (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
        if (matchingInstIds.has(inst.id) && inst.gateway_server_id) neededGwSrvIds.add(inst.gateway_server_id);
      }));
    });
    neededGwSrvIds.forEach(id => {
      if (!visibleSrvIds.has(id)) { visibleSrvIds.add(id); addedGwSrv = true; }
    });
  }

  const newHiddenByFilter = new Set();
  allServers.forEach(s => { if (!visibleSrvIds.has(s.id)) newHiddenByFilter.add(s.id); });
  setHiddenByFilter(newHiddenByFilter);
  _updateFilterStatus(true, visibleSrvIds.size, allServers.length);

  // ── 3. Environments reachable from visible servers/instances ──────────────
  const visibleEnvIds = new Set();
  const directGwRouterIds = new Set();
  allServers.forEach(s => {
    if (visibleSrvIds.has(s.id)) {
      (s.environments || []).forEach(e => visibleEnvIds.add(e.id));
      if (s.gateway_router_id) directGwRouterIds.add(s.gateway_router_id);
    }
    (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      if (matchingInstIds.has(inst.id)) {
        (inst.environments || []).forEach(e => visibleEnvIds.add(e.id));
        if (inst.gateway_router_id) directGwRouterIds.add(inst.gateway_router_id);
      }
    }));
  });
  directGwRouterIds.forEach(rid => {
    const r = allRouters.find(r => r.id === rid);
    if (r) (r.environments || []).forEach(e => visibleEnvIds.add(e.id));
  });

  // Switch-node visibility needs a *stricter* set than visibleEnvIds above:
  // visibleEnvIds intentionally also includes environments only "reachable"
  // via a gateway router shared with a visible environment (so that router
  // stays visible) — but a switch represents one specific environment and
  // must only show when that environment itself has an actual visible
  // member, or is the one directly selected in the filter.
  const switchVisibleEnvIds = new Set();
  allEnvironments.forEach(env => {
    const hasVisibleServerMember = allServers.some(s =>
      visibleSrvIds.has(s.id) && (s.environments || []).some(e => e.id === env.id));
    const hasVisibleInstMember = allServers.some(s => (s.services || []).some(svc =>
      (svc.instances || []).some(inst =>
        matchingInstIds.has(inst.id) && (inst.environments || []).some(e => e.id === env.id))));
    if (hasVisibleServerMember || hasVisibleInstMember || env.id === envId) {
      switchVisibleEnvIds.add(env.id);
    }
  });

  // ── 4. Visible routers ────────────────────────────────────────────────────
  const hiddenRouterIds = new Set();
  allRouters.forEach(r => {
    const servesEnv = (r.environments || []).some(e => visibleEnvIds.has(e.id));
    if (!servesEnv && !directGwRouterIds.has(r.id)) hiddenRouterIds.add(r.id);
  });
  const anyRouterVisible = allRouters.some(r => !hiddenRouterIds.has(r.id));
  const visibleProviders = new Set(
    allRouters.filter(r => !hiddenRouterIds.has(r.id) && r.provider).map(r => r.provider)
  );

  // ── 5. Visible clusters ───────────────────────────────────────────────────
  const hiddenClusterIds = new Set();
  allClusters.forEach(cl => {
    const hasMember = (cl.members || []).some(m =>
      allServers.some(s => (s.services || []).some(svc =>
        (svc.instances || []).some(inst => inst.id === m.id && matchingInstIds.has(inst.id)))));
    const hasOwnInEnv = envId && !appId &&
      (cl.own_instances || []).some(oi => (oi.environments || []).some(e => e.id === envId));
    if (!hasMember && !hasOwnInEnv) hiddenClusterIds.add(cl.id);
  });

  // ── 6. Node updates ───────────────────────────────────────────────────────
  allServers.forEach(s => {
    const hidden = !visibleSrvIds.has(s.id);
    nodeUpdates.push({ id: s.id, hidden, physics: !hidden });
    (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      const ih = hidden || !matchingInstIds.has(inst.id);
      if (nodes.get('inst_' + inst.id)) nodeUpdates.push({ id: 'inst_' + inst.id, hidden: ih, physics: !ih });
      if (edges.get('si_'  + inst.id)) edgeUpdates.push({ id: 'si_'  + inst.id, hidden: ih });
    }));
  });
  // Routers/providers/cloud relevant to the current filter (i.e. not in
  // hiddenRouterIds / visibleProviders) stay visible regardless of the
  // "🌐 Internet" toggle — the toggle only governs the unfiltered view.
  allRouters.forEach(r => {
    const id = 'router_' + r.id;
    const rHidden = hiddenRouterIds.has(r.id);
    if (nodes.get(id)) nodeUpdates.push({ id, hidden: rHidden, physics: !rHidden });
  });
  const anyExternVisible = allServers.some(s => isExternServer(s) && visibleSrvIds.has(s.id));
  if (nodes.get('internet_cloud')) {
    const cloudHidden = !anyRouterVisible && !anyExternVisible;
    nodeUpdates.push({ id: 'internet_cloud', hidden: cloudHidden, physics: !cloudHidden });
  }
  nodes.forEach(n => {
    if (typeof n.id === 'string' && n.id.startsWith('provider_')) {
      const pHidden = !visibleProviders.has(n.id.replace('provider_', ''));
      nodeUpdates.push({ id: n.id, hidden: pHidden, physics: !pHidden });
    }
  });
  allClusters.forEach(cl => {
    if (nodes.get('cluster_' + cl.id)) {
      const clHidden = hiddenClusterIds.has(cl.id);
      nodeUpdates.push({ id: 'cluster_' + cl.id, hidden: clHidden, physics: !clHidden });
    }
  });
  allEnvironments.forEach(env => {
    const id = 'switch_' + env.id;
    if (nodes.get(id)) {
      const swHidden = !switchVisibleEnvIds.has(env.id);
      nodeUpdates.push({ id, hidden: swHidden, physics: !swHidden });
    }
  });

  // ── 7. Edge updates ───────────────────────────────────────────────────────
  // Gateway/internet-backbone edges are matched by prefix *before* the
  // generic inetEdgeIds membership check below, so their visibility follows
  // filter relevance (hiddenRouterIds/visibleSrvIds/visibleProviders)
  // instead of being forced by the "🌐 Internet" toggle while a filter is
  // active — a router-type gateway edge is a member of inetEdgeIds too
  // (see graph.js), so it would otherwise be caught by that shortcut first.
  edges.forEach(e => {
    const id = e.id;
    if (typeof id !== 'string') return;
    if (id.startsWith('switch_mem_srv_')) {
      const swEnvId = parseInt(String(e.from).replace('switch_', ''));
      edgeUpdates.push({ id, hidden: !switchVisibleEnvIds.has(swEnvId) || !visibleSrvIds.has(e.to) }); return;
    }
    if (id.startsWith('switch_mem_inst_')) {
      const swEnvId = parseInt(String(e.from).replace('switch_', ''));
      const instId = parseInt(String(e.to).replace('inst_', ''));
      edgeUpdates.push({ id, hidden: !switchVisibleEnvIds.has(swEnvId) || !matchingInstIds.has(instId) }); return;
    }
    if (id.startsWith('switch_gw_')) {
      const swEnvId = parseInt(id.replace('switch_gw_', ''));
      edgeUpdates.push({ id, hidden: !switchVisibleEnvIds.has(swEnvId) }); return;
    }
    if (id.startsWith('gw_srv_')) {
      const fromRouter = typeof e.from === 'string' && e.from.startsWith('router_');
      const rHidden = fromRouter && hiddenRouterIds.has(parseInt(e.from.replace('router_', '')));
      edgeUpdates.push({ id, hidden: !visibleSrvIds.has(e.to) || rHidden }); return;
    }
    if (id.startsWith('gw_inst_')) {
      const instId = parseInt(id.replace('gw_inst_', ''));
      edgeUpdates.push({ id, hidden: !matchingInstIds.has(instId) }); return;
    }
    if (id.startsWith('inet_up_')) {
      const rid = parseInt(id.replace('inet_up_', ''));
      edgeUpdates.push({ id, hidden: hiddenRouterIds.has(rid) }); return;
    }
    if (id.startsWith('inet_link_')) {
      const rid = parseInt(id.replace('inet_link_', ''));
      const r = allRouters.find(rt => rt.id === rid);
      const linkHidden = hiddenRouterIds.has(rid) || (r && r.server_id != null && !visibleSrvIds.has(r.server_id));
      edgeUpdates.push({ id, hidden: linkHidden }); return;
    }
    if (id.startsWith('inet_prov_')) {
      const prov = id.replace('inet_prov_provider_', '');
      edgeUpdates.push({ id, hidden: !visibleProviders.has(prov) }); return;
    }
    if (inetEdgeIds.includes(id)) { edgeUpdates.push({ id, hidden: !showInternet }); return; }
    if (id.startsWith('inet_extern_')) {
      const srvId = parseInt(id.replace('inet_extern_', ''));
      edgeUpdates.push({ id, hidden: !visibleSrvIds.has(srvId) }); return;
    }
    if (id.startsWith('sr_')) {
      edgeUpdates.push({ id, hidden: !visibleSrvIds.has(e.from) || !visibleSrvIds.has(e.to) });
    } else if (id.startsWith('ir_srv_')) {
      edgeUpdates.push({ id, hidden: showingInstances || !visibleSrvIds.has(e.from) || !visibleSrvIds.has(e.to) });
    } else if (id.startsWith('ir_inst_')) {
      const rel = allInstanceRelations.find(r => r.id === parseInt(id.replace('ir_inst_', '')));
      if (!rel) return;
      const srcH = rel.source_instance_id ? !matchingInstIds.has(rel.source_instance_id)
                 : rel.source_cluster_id   ? hiddenClusterIds.has(rel.source_cluster_id) : false;
      const tgtH = rel.target_instance_id ? !matchingInstIds.has(rel.target_instance_id)
                 : rel.target_cluster_id   ? hiddenClusterIds.has(rel.target_cluster_id) : false;
      edgeUpdates.push({ id, hidden: srcH || tgtH });
    } else if (id.startsWith('cl_member_')) {
      const parts = id.split('_');
      const clId = parseInt(parts[2]), mId = parseInt(parts[3]);
      edgeUpdates.push({ id, hidden: hiddenClusterIds.has(clId) || !matchingInstIds.has(mId) });
    }
  });

  nodes.update(nodeUpdates);
  edges.update(edgeUpdates);
  if (layoutMode === 'hierarchical') {
    const pos = computeHierarchicalPositions({
      srvFilter: visibleSrvIds,
      instFilter: matchingInstIds,
      clFilter: hiddenClusterIds,
      rtrFilter: hiddenRouterIds,
    });
    Object.entries(pos).forEach(([id, { x, y }]) => {
      const nid = isNaN(Number(id)) ? id : Number(id);
      const bn = network.body.nodes[nid];
      if (bn) { bn.x = x; bn.y = y; }
    });
  }
  if (!skipFit) {
    fitVisible();
    if (layoutMode !== 'hierarchical') network.stabilize(150);
  }
  network.redraw();
}

/**
 * Registers filter dropdown change listeners.
 */
export function initFilters() {
  ['env-filter', 'app-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => applyFilters());
  });
  document.getElementById('filter-reset-btn').addEventListener('click', resetFilters);
}
