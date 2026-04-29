/*
 * filters.js — environment/application filter logic and internet-toggle handler.
 * Exports: applyFilters, updateFilters, toggleInternet, initFilters.
 */
'use strict';

import {
  allServers, allEnvironments, allApplications, allClusters, allRouters,
  allInstanceRelations,
  network, nodes, edges,
  layoutMode,
  inetNodeIds, inetEdgeIds,
  showInternet, setShowInternet,
  showingInstances,
  hiddenByFilter, setHiddenByFilter,
  isExternServer,
} from './state.js';

import { computeHierarchicalPositions } from './graph.js';

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
 * Applies the current env/app filter selection to show/hide nodes and edges.
 */
export function applyFilters(skipFit = false) {
  if (!nodes || !edges || !network) return;
  const envId = parseInt(document.getElementById('env-filter').value) || 0;
  const appId = parseInt(document.getElementById('app-filter').value) || 0;
  const isFiltered = envId || appId;
  const nodeUpdates = [], edgeUpdates = [];

  if (!isFiltered) {
    setHiddenByFilter(new Set());
    allServers.forEach(s => {
      const hideExt = isExternServer(s) && !showInternet;
      nodeUpdates.push({ id: s.id, hidden: hideExt });
      (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
        if (nodes.get('inst_' + inst.id)) nodeUpdates.push({ id: 'inst_' + inst.id, hidden: hideExt });
        if (edges.get('si_'  + inst.id)) edgeUpdates.push({ id: 'si_'  + inst.id, hidden: hideExt });
      }));
    });
    allClusters.forEach(cl => {
      if (nodes.get('cluster_' + cl.id)) nodeUpdates.push({ id: 'cluster_' + cl.id, hidden: false });
    });
    inetNodeIds.forEach(id => { if (nodes.get(id)) nodeUpdates.push({ id, hidden: !showInternet }); });
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
      network.fit();
      if (layoutMode !== 'hierarchical') network.stabilize(150);
    }
    network.redraw();
    return;
  }

  // ── 1. Matching instance IDs ──────────────────────────────────────────────
  const matchingInstIds = new Set();
  allServers.forEach(s => (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
    let ok = true;
    if (envId && !(inst.environments || []).some(e => e.id === envId)) ok = false;
    if (appId && !(inst.applications || []).some(a => a.id === appId)) ok = false;
    if (ok) matchingInstIds.add(inst.id);
  })));

  // ── 2. Visible servers ────────────────────────────────────────────────────
  const newHiddenByFilter = new Set();
  const visibleSrvIds = new Set();
  allServers.forEach(s => {
    const hasMatchingInst = (s.services || []).some(svc =>
      (svc.instances || []).some(inst => matchingInstIds.has(inst.id)));
    const bareInEnv = envId && !appId && (s.environments || []).some(e => e.id === envId) &&
      !(s.services || []).some(svc => (svc.instances || []).length > 0);
    if (hasMatchingInst || bareInEnv) visibleSrvIds.add(s.id);
    else newHiddenByFilter.add(s.id);
  });
  setHiddenByFilter(newHiddenByFilter);

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
    nodeUpdates.push({ id: s.id, hidden });
    (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      const ih = hidden || !matchingInstIds.has(inst.id);
      if (nodes.get('inst_' + inst.id)) nodeUpdates.push({ id: 'inst_' + inst.id, hidden: ih });
      if (edges.get('si_'  + inst.id)) edgeUpdates.push({ id: 'si_'  + inst.id, hidden: ih });
    }));
  });
  allRouters.forEach(r => {
    const id = 'router_' + r.id;
    if (nodes.get(id)) nodeUpdates.push({ id, hidden: !showInternet || hiddenRouterIds.has(r.id) });
  });
  const anyExternVisible = allServers.some(s => isExternServer(s) && visibleSrvIds.has(s.id));
  if (nodes.get('internet_cloud'))
    nodeUpdates.push({ id: 'internet_cloud', hidden: (!showInternet || !anyRouterVisible) && !anyExternVisible });
  nodes.forEach(n => {
    if (typeof n.id === 'string' && n.id.startsWith('provider_'))
      nodeUpdates.push({ id: n.id, hidden: !showInternet || !visibleProviders.has(n.id.replace('provider_', '')) });
  });
  allClusters.forEach(cl => {
    if (nodes.get('cluster_' + cl.id))
      nodeUpdates.push({ id: 'cluster_' + cl.id, hidden: hiddenClusterIds.has(cl.id) });
  });

  // ── 7. Edge updates ───────────────────────────────────────────────────────
  edges.forEach(e => {
    const id = e.id;
    if (typeof id !== 'string') return;
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
    } else if (id.startsWith('gw_srv_')) {
      const fromRouter = typeof e.from === 'string' && e.from.startsWith('router_');
      const rHidden = fromRouter && hiddenRouterIds.has(parseInt(e.from.replace('router_', '')));
      edgeUpdates.push({ id, hidden: !visibleSrvIds.has(e.to) || (fromRouter && (!showInternet || rHidden)) });
    } else if (id.startsWith('gw_inst_')) {
      const instId = parseInt(id.replace('gw_inst_', ''));
      const fromRouter = typeof e.from === 'string' && e.from.startsWith('router_');
      edgeUpdates.push({ id, hidden: !matchingInstIds.has(instId) || (fromRouter && !showInternet) });
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
    network.fit();
    if (layoutMode !== 'hierarchical') network.stabilize(150);
  }
  network.redraw();
}

/**
 * Handles the Internet-toggle checkbox — shows/hides internet nodes and extern servers.
 */
export function toggleInternet() {
  setShowInternet(document.getElementById('show-internet').checked);
  if (!nodes || !edges) return;
  inetNodeIds.forEach(id => { if (nodes.get(id)) nodes.update({ id, hidden: !showInternet }); });
  inetEdgeIds.forEach(id => { if (edges.get(id)) edges.update({ id, hidden: !showInternet }); });
  const envId = parseInt(document.getElementById('env-filter').value) || 0;
  const appId = parseInt(document.getElementById('app-filter').value) || 0;
  if (!envId && !appId) {
    allServers.filter(isExternServer).forEach(s => {
      if (nodes.get(s.id)) nodes.update({ id: s.id, hidden: !showInternet });
      const eid = 'inet_extern_' + s.id;
      if (edges.get(eid)) edges.update({ id: eid, hidden: !showInternet });
    });
  }
  if (showingInstances) {
    allServers.forEach(s => (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      if (inst.gateway_router_id && edges.get('gw_inst_' + inst.id))
        edges.update({ id: 'gw_inst_' + inst.id, hidden: !showInternet });
    })));
  }
}

/**
 * Registers filter dropdown change listeners.
 */
export function initFilters() {
  ['env-filter', 'app-filter'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => applyFilters());
  });
  document.getElementById('show-internet').addEventListener('change', toggleInternet);
}
