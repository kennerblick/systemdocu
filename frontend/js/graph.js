/*
 * graph.js — vis-network graph construction, rendering, patching, and event handlers.
 * Exports: buildNode, renderGraph, patchGraph, computeHierarchicalPositions,
 *          toggleLayout, updateInstanceVisibility, renderLegend.
 */
'use strict';

import {
  allServers, allRelations, allEnvironments, allClusters,
  allInstanceRelations, allRouters,
  network, nodes, edges,
  setNetwork, setNodes, setEdges,
  layoutMode, setLayoutMode,
  currentRenderedLayout, setCurrentRenderedLayout,
  irSrvEdgeIds, setIrSrvEdgeIds,
  inetNodeIds, inetEdgeIds, setInetNodeIds, setInetEdgeIds,
  showInternet,
  hiddenByFilter,
  showingInstances, setShowingInstances,
  INST_ZOOM_THRESHOLD,
  OS_COLORS, SVC_COLORS,
  VM_SVC_TYPES,
  INST_ICONS,
  isExternServer,
  currentServerId, currentClusterId,
} from './state.js';

import { buildInstServerMap } from './utils.js';
import { applyFilters } from './filters.js';
import { stopBlink } from './search.js';
import { openSidebar, closeSidebar } from './sidebar.js';
import { openClusterSidebar } from './cluster.js';

/** Returns the primary display colour for a server node. */
function serverColor(server) {
  if (server.environments && server.environments.length > 0) return server.environments[0].color;
  return OS_COLORS[server.os_type] || '#888';
}

/**
 * Builds a vis-network node object for the given server.
 */
export function buildNode(server) {
  const col = serverColor(server);
  return {
    id: server.id,
    label: server.hostname,
    shape: 'dot',
    size: 18,
    color: { background: col, border: col, highlight: { background: col, border: '#fff' } },
    font: { color: '#e0e0e0', size: 13 },
    title: '[' + server.os_type + '] ' + server.hostname +
           (server.ip ? '<br>' + server.ip.split(',').map(s => s.trim()).filter(Boolean).join('<br>') : '') +
           (server.is_gateway ? '<br>⚡ fungiert als Gateway' : '') +
           (server.gateway_router_id ? '<br>GW: ' + ((allRouters.find(r => r.id === server.gateway_router_id) || {}).name || '?') : '') +
           (server.gateway_server_id ? '<br>GW: ' + ((allServers.find(s => s.id === server.gateway_server_id) || {}).hostname || '?') : ''),
  };
}

/** Builds instance nodes, cluster nodes, and all associated edges for zoomed-in view. */
function buildInstanceNodesEdges() {
  const instNodes = [], siEdges = [], irInstEdges = [], gwInstEdges = [];
  allServers.forEach(s => {
    (s.services || []).forEach(svc => {
      const col = SVC_COLORS[svc.type] || '#4b5563';
      (svc.instances || []).forEach(inst => {
        const gwR = inst.gateway_router_id ? allRouters.find(r => r.id === inst.gateway_router_id) : null;
        const gwS = inst.gateway_server_id ? allServers.find(sv => sv.id === inst.gateway_server_id) : null;
        const gwI = inst.gateway_instance_id ? (() => {
          for (const srv2 of allServers) for (const svc2 of (srv2.services || [])) for (const i2 of (svc2.instances || [])) if (i2.id === inst.gateway_instance_id) return i2;
          return null;
        })() : null;
        instNodes.push({
          id: 'inst_' + inst.id,
          label: (inst.is_gateway ? '⚡' : (INST_ICONS[svc.type] || '⚙')) + ' ' + inst.name,
          title: inst.name +
                 (inst.is_gateway ? '<br>⚡ fungiert als Gateway' : '') +
                 (inst.ip ? '<br>' + inst.ip.split(',').map(s => s.trim()).filter(Boolean).join('<br>') : '') +
                 (inst.environments && inst.environments.length
                   ? '<br>🌍 ' + inst.environments.map(e => e.name).join(', ') : '') +
                 (gwR ? '<br>GW: ' + gwR.name : '') +
                 (gwS ? '<br>GW: ' + gwS.hostname : '') +
                 (gwI ? '<br>GW: ' + gwI.name : '') +
                 ((inst.own_services || []).length
                   ? '<br>' + inst.own_services.map(s => (INST_ICONS[s.type] || '⚙') + ' ' + s.type + (s.port ? ':' + s.port : '')).join('  ') : ''),
          shape: 'box',
          color: { background: col + 'bb', border: col, highlight: { background: col, border: '#fff' } },
          font: { color: '#f0f0f0', size: 11 },
          margin: { top: 5, bottom: 5, left: 7, right: 7 },
          borderWidth: 1,
        });
        const isVM = VM_SVC_TYPES.has(svc.type);
        siEdges.push({
          id: 'si_' + inst.id, from: s.id, to: 'inst_' + inst.id,
          color: { color: col, opacity: isVM ? 0.15 : 0.45 },
          width: isVM ? 0.5 : 1,
          dashes: isVM ? false : [3, 6],
          arrows: '',
          length: isVM ? 85 : 140,
          title: s.hostname + ' → ' + svc.type + ': ' + inst.name,
        });
        if (inst.gateway_router_id) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: 'router_' + inst.gateway_router_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 1, dashes: [4, 4], physics: false, smooth: { enabled: false },
            color: { color: '#f97316', opacity: 0.65 },
            title: 'Gateway: ' + ((allRouters.find(r => r.id === inst.gateway_router_id) || {}).name || '?'),
            hidden: !showInternet,
          });
        } else if (inst.gateway_server_id) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: inst.gateway_server_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 1, dashes: [4, 4], physics: false, smooth: { enabled: false },
            color: { color: '#22d3ee', opacity: 0.65 },
            title: 'Gateway: ' + ((allServers.find(sv => sv.id === inst.gateway_server_id) || {}).hostname || '?'),
          });
        } else if (inst.gateway_instance_id) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: 'inst_' + inst.gateway_instance_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 1, dashes: [4, 4], physics: false, smooth: { enabled: false },
            color: { color: '#22d3ee', opacity: 0.65 },
            title: 'Gateway: ' + (gwI ? gwI.name : inst.gateway_instance_id),
          });
        }
      });
    });
  });
  const im = buildInstServerMap();

  const clusterNodes = [];
  const clusterEdges = [];
  allClusters.forEach(cl => {
    const col = SVC_COLORS[cl.service_type] || '#4b5563';
    clusterNodes.push({
      id: 'cluster_' + cl.id,
      label: '◆ ' + cl.name + (cl.domain ? '\n' + cl.domain : ''),
      title: cl.name + ' [' + cl.service_type + ']' +
             (cl.domain ? '<br>🌐 ' + cl.domain : '') +
             (cl.description ? '<br>' + cl.description : '') +
             (cl.members && cl.members.length ? '<br>Mitglieder: ' + cl.members.map(m => m.name).join(', ') : ''),
      shape: 'diamond',
      size: 20,
      color: { background: col + 'cc', border: col, highlight: { background: col, border: '#fff' } },
      font: { color: '#f0f0f0', size: 12 },
    });
    (cl.members || []).forEach(m => {
      clusterEdges.push({
        id: 'cl_member_' + cl.id + '_' + m.id,
        from: 'cluster_' + cl.id, to: 'inst_' + m.id,
        arrows: '', width: 1, dashes: [4, 4],
        color: { color: col, opacity: 0.6 },
        title: cl.name + ' → ' + m.name,
      });
    });
  });

  allInstanceRelations.forEach(r => {
    const srcNode = r.source_cluster_id ? 'cluster_' + r.source_cluster_id : 'inst_' + r.source_instance_id;
    const tgtNode = r.target_cluster_id ? 'cluster_' + r.target_cluster_id : 'inst_' + r.target_instance_id;
    const src = r.source_instance_id ? im[r.source_instance_id] : null;
    const tgt = r.target_instance_id ? im[r.target_instance_id] : null;
    const srcCl = r.source_cluster_id ? allClusters.find(c => c.id === r.source_cluster_id) : null;
    const tgtCl = r.target_cluster_id ? allClusters.find(c => c.id === r.target_cluster_id) : null;
    const srcSrv = src ? allServers.find(s => s.id === src.serverId) : null;
    const tgtSrv = tgt ? allServers.find(s => s.id === tgt.serverId) : null;
    const srcLabel = srcCl ? srcCl.name : (src ? src.svcType + ': ' + src.name + ' @ ' + (srcSrv ? srcSrv.hostname : '?') : '?');
    const tgtLabel = tgtCl ? tgtCl.name : (tgt ? tgt.svcType + ': ' + tgt.name + ' @ ' + (tgtSrv ? tgtSrv.hostname : '?') : '?');
    const dir = r.direction || 'to';
    irInstEdges.push({
      id: 'ir_inst_' + r.id,
      from: srcNode, to: tgtNode,
      arrows: dir === 'both' ? { to: { enabled: true }, from: { enabled: true } }
            : dir === 'none' ? { to: { enabled: false }, from: { enabled: false } }
            : dir === 'from' ? { to: { enabled: false }, from: { enabled: true } }
            : 'to',
      width: 2,
      color: { color: '#7c3aed' },
      title: srcLabel +
             (dir === 'both' ? ' ↔ ' : dir === 'none' ? ' — ' : dir === 'from' ? ' ← ' : ' → ') +
             tgtLabel + '<br>' + r.type,
    });
  });
  return { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges };
}

/** Builds the internet/router nodes and edges (shown when showInternet is true). */
function buildInternetGraph() {
  const newInetNodeIds = [];
  const newInetEdgeIds = [];
  const iNodes = [], iEdges = [];
  const externSrvs = allServers.filter(isExternServer);
  if (!allRouters.length && !externSrvs.length) {
    setInetNodeIds([]);
    setInetEdgeIds([]);
    return { iNodes, iEdges };
  }

  const hidden = !showInternet;
  const isHier = layoutMode === 'hierarchical';

  iNodes.push({
    id: 'internet_cloud',
    label: '🌐\nInternet',
    shape: 'ellipse',
    ...(isHier ? {} : { x: -1400, y: 0, fixed: true }),
    size: 34,
    color: { background: '#0c2340', border: '#3b82f6', highlight: { background: '#0c2340', border: '#60a5fa' } },
    font: { color: '#93c5fd', size: 13 },
    hidden,
  });
  newInetNodeIds.push('internet_cloud');

  const rootRouters = allRouters.filter(r => !r.upstream_router_id);
  const providerNames = [...new Set(rootRouters.filter(r => r.provider).map(r => r.provider))];
  const nProv = providerNames.length;
  const knownProviders = new Set(providerNames);
  providerNames.forEach((prov, i) => {
    const y = (i - (nProv - 1) / 2) * 160;
    const nodeId = 'provider_' + prov;
    iNodes.push({
      id: nodeId,
      label: '📡 ' + prov,
      shape: 'ellipse',
      ...(isHier ? {} : { x: -1150, y, fixed: true }),
      size: 22,
      color: { background: '#0c1f35', border: '#38bdf8', highlight: { background: '#0f2a45', border: '#7dd3fc' } },
      font: { color: '#7dd3fc', size: 11 },
      hidden,
    });
    newInetNodeIds.push(nodeId);
    const eid = 'inet_prov_' + nodeId;
    iEdges.push({ id: eid, from: 'internet_cloud', to: nodeId, arrows: 'to', width: 2,
      physics: false, color: { color: '#3b82f6' }, hidden });
    newInetEdgeIds.push(eid);
  });

  const n = allRouters.length;
  allRouters.forEach((r, idx) => {
    const titleParts = [];
    if (r.provider)    titleParts.push('Anbieter: ' + r.provider);
    if (r.external_ip) titleParts.push('Externe IP: ' + r.external_ip);
    if (r.internal_ip) titleParts.push('Interne IP: ' + r.internal_ip);
    if (r.server_id) {
      const srv = allServers.find(s => s.id === r.server_id);
      if (srv) titleParts.push('Server: ' + srv.hostname);
    }
    if (r.environments && r.environments.length)
      titleParts.push('Netze: ' + r.environments.map(e => e.subnet || e.name).join(', '));

    const fromNode = 'router_' + r.id;
    const y = (idx - (n - 1) / 2) * 160;
    iNodes.push({
      id: fromNode,
      label: '🔒 ' + r.name + (r.external_ip ? '\n' + r.external_ip : ''),
      shape: 'box',
      ...(isHier ? {} : { x: -900, y, fixed: true }),
      color: { background: '#1c1508', border: '#f97316', highlight: { background: '#2d1f0a', border: '#fb923c' } },
      font: { color: '#fed7aa', size: 11 },
      margin: { top: 6, bottom: 6, left: 9, right: 9 },
      borderWidth: 1.5,
      hidden,
      title: titleParts.join('<br>') || r.name,
    });
    newInetNodeIds.push(fromNode);

    if (r.server_id) {
      const linkId = 'inet_link_' + r.id;
      iEdges.push({
        id: linkId, from: fromNode, to: r.server_id,
        arrows: 'to', width: 1.5, dashes: [4, 2],
        physics: false,
        color: { color: '#6b7280' },
        title: 'Gateway-Server',
        hidden,
      });
      newInetEdgeIds.push(linkId);
    }

    let upFrom;
    if (r.upstream_router_id) {
      upFrom = 'router_' + r.upstream_router_id;
    } else if (r.provider && knownProviders.has(r.provider)) {
      upFrom = 'provider_' + r.provider;
    } else {
      upFrom = 'internet_cloud';
    }
    const edgeId = 'inet_up_' + r.id;
    iEdges.push({
      id: edgeId, from: upFrom, to: fromNode,
      arrows: 'to',
      width: r.upstream_router_id ? 1.5 : 2,
      dashes: r.upstream_router_id ? [5, 3] : false,
      color: { color: r.upstream_router_id ? '#f97316' : '#38bdf8' },
      title: r.upstream_router_id ? 'Routing → ' + r.name : (r.external_ip || 'Anschluss'),
      hidden,
    });
    newInetEdgeIds.push(edgeId);
  });

  externSrvs.forEach(s => {
    iEdges.push({
      id: 'inet_extern_' + s.id, from: 'internet_cloud', to: s.id,
      arrows: 'to', width: 2, physics: true,
      color: { color: '#3b82f6', opacity: 0.7 },
      title: 'Direkte Internet-Verbindung',
      hidden,
    });
  });

  setInetNodeIds(newInetNodeIds);
  setInetEdgeIds(newInetEdgeIds);
  return { iNodes, iEdges };
}

/**
 * Computes fixed x/y positions for all nodes in hierarchical layout mode.
 */
export function computeHierarchicalPositions(opts = {}) {
  const NODE_W = 150, NODE_H = 80, COL_GAP = 90, VM_GAP = 30, BELOW_GAP = 70;
  const pos = {};

  const _servers  = opts.srvFilter  ? allServers.filter(s => opts.srvFilter.has(s.id))   : allServers;
  const _routers  = opts.rtrFilter  ? allRouters.filter(r => !opts.rtrFilter.has(r.id))  : allRouters;
  const _clusters = opts.clFilter   ? allClusters.filter(c => !opts.clFilter.has(c.id))  : allClusters;
  const _instF    = opts.instFilter;

  const _externSrvs = _servers.filter(isExternServer);
  const _colSrvs    = _servers.filter(s => !isExternServer(s));

  const sortByName = arr => [...arr].sort((a, b) => a.hostname.localeCompare(b.hostname));
  const isVmHost   = s => (s.services || []).some(svc =>
    VM_SVC_TYPES.has(svc.type) &&
    (svc.instances || []).some(inst => !_instF || _instF.has(inst.id)));

  const envOrder = [];
  const seenEnvs = new Set();
  _routers.forEach(r => (r.environments || []).forEach(env => {
    if (!seenEnvs.has(env.id)) { seenEnvs.add(env.id); envOrder.push(env.id); }
  }));
  allEnvironments.forEach(env => {
    if (!seenEnvs.has(env.id) &&
        _colSrvs.some(s => (s.environments || []).some(e => e.id === env.id))) {
      seenEnvs.add(env.id); envOrder.push(env.id);
    }
  });

  if (envOrder.length > 1) {
    const envAdj = new Map(allEnvironments.map(e => [e.id, new Set()]));
    const gwSrvEnvs = new Map();
    _colSrvs.forEach(s => {
      if (s.is_gateway && (s.environments || []).length)
        gwSrvEnvs.set(s.id, s.environments.map(e => e.id));
    });
    _colSrvs.forEach(s => {
      if (!s.gateway_server_id) return;
      const srcEnvIds = (s.environments || []).map(e => e.id);
      const gwEnvIds  = gwSrvEnvs.get(s.gateway_server_id) || [];
      srcEnvIds.forEach(a => gwEnvIds.forEach(b => {
        if (a !== b) { envAdj.get(a)?.add(b); envAdj.get(b)?.add(a); }
      }));
    });
    const remaining = new Set(envOrder);
    const ordered   = [envOrder[0]];
    remaining.delete(envOrder[0]);
    while (remaining.size) {
      const last = ordered[ordered.length - 1];
      const adj  = [...(envAdj.get(last) || [])].filter(id => remaining.has(id));
      const next = adj.length ? adj[0] : [...remaining][0];
      ordered.push(next);
      remaining.delete(next);
    }
    envOrder.length = 0;
    ordered.forEach(id => envOrder.push(id));
  }

  const envServerMap = new Map(envOrder.map(id => [id, []]));
  const noEnvServers = [];
  sortByName(_colSrvs).forEach(s => {
    const envId = s.environments && s.environments.length ? s.environments[0].id : null;
    if (envId && envServerMap.has(envId)) envServerMap.get(envId).push(s);
    else noEnvServers.push(s);
  });

  function maxVmCols(servers) {
    return servers.filter(isVmHost).reduce((m, host) => {
      const n = (host.services || []).filter(svc => VM_SVC_TYPES.has(svc.type))
        .reduce((s, svc) => s + (svc.instances || []).filter(i => !_instF || _instF.has(i.id)).length, 0);
      return Math.max(m, n ? Math.ceil(Math.sqrt(n)) : 1);
    }, 1);
  }

  const colDefs = [];
  envOrder.forEach(envId => {
    const servers = envServerMap.get(envId) || [];
    if (!servers.length) return;
    colDefs.push({ envId, servers, colW: maxVmCols(servers) * NODE_W });
  });
  if (noEnvServers.length)
    colDefs.push({ envId: null, servers: noEnvServers, colW: maxVmCols(noEnvServers) * NODE_W });

  const totalW = colDefs.reduce((s, c, i) => s + c.colW + (i < colDefs.length - 1 ? COL_GAP : 0), 0);
  let curX = -totalW / 2;
  const envColCx = new Map();
  colDefs.forEach(cd => {
    cd.cx = curX + cd.colW / 2;
    if (cd.envId) envColCx.set(cd.envId, cd.cx);
    curX += cd.colW + COL_GAP;
  });

  function placeColumn(servers, cx) {
    let y = 0;
    const plain   = sortByName(servers.filter(s => !isVmHost(s)));
    const vmHosts = sortByName(servers.filter(isVmHost));
    plain.forEach(s => { pos[s.id] = { x: cx, y }; y += NODE_H; });
    if (plain.length && vmHosts.length) y += VM_GAP;
    vmHosts.forEach(host => {
      pos[host.id] = { x: cx, y }; y += NODE_H;
      const vms = [];
      (host.services || []).forEach(svc => {
        if (VM_SVC_TYPES.has(svc.type))
          [...(svc.instances || [])].filter(inst => !_instF || _instF.has(inst.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(inst => vms.push('inst_' + inst.id));
      });
      if (vms.length) {
        const vc = Math.ceil(Math.sqrt(vms.length));
        vms.forEach((vmId, vi) => {
          pos[vmId] = { x: cx + (vi % vc - (vc - 1) / 2) * NODE_W, y: y + Math.floor(vi / vc) * NODE_H };
        });
        y += Math.ceil(vms.length / vc) * NODE_H + VM_GAP;
      }
    });
    return y;
  }

  let maxColH = 0;
  colDefs.forEach(cd => { maxColH = Math.max(maxColH, placeColumn(cd.servers, cd.cx)); });

  let y = maxColH + BELOW_GAP;
  const placeGrid = (ids, startY) => {
    if (!ids.length) return 0;
    const cols = Math.ceil(Math.sqrt(ids.length));
    ids.forEach((id, i) => {
      pos[id] = { x: (i % cols - (cols - 1) / 2) * NODE_W, y: startY + Math.floor(i / cols) * NODE_H };
    });
    return Math.ceil(ids.length / cols) * NODE_H;
  };
  const clusterIds = _clusters.map(c => 'cluster_' + c.id);
  if (clusterIds.length) { y += placeGrid(clusterIds, y) + BELOW_GAP; }
  const instByColCx = new Map();
  const noColInsts = [];
  sortByName(_colSrvs).forEach(s => (s.services || []).forEach(svc => {
    if (VM_SVC_TYPES.has(svc.type)) return;
    [...(svc.instances || [])].filter(inst => !_instF || _instF.has(inst.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(inst => {
        const cx = [...(inst.environments || []), ...(s.environments || [])]
          .map(e => envColCx.get(e.id))
          .find(x => x !== undefined);
        if (cx !== undefined) {
          if (!instByColCx.has(cx)) instByColCx.set(cx, []);
          instByColCx.get(cx).push('inst_' + inst.id);
        } else {
          noColInsts.push('inst_' + inst.id);
        }
      });
  }));
  instByColCx.forEach((insts, cx) => {
    const n = insts.length;
    const cols = Math.ceil(Math.sqrt(n));
    insts.forEach((id, i) => {
      pos[id] = { x: cx + (i % cols - (cols - 1) / 2) * NODE_W, y: y + Math.floor(i / cols) * NODE_H };
    });
  });
  if (noColInsts.length) placeGrid(noColInsts, y);

  if (_routers.length || _externSrvs.length) {
    if (_routers.length) {
      const rootRouters   = _routers.filter(r => !r.upstream_router_id);
      const providerNames = [...new Set(rootRouters.filter(r => r.provider).map(r => r.provider))];
      _routers.forEach((r, idx) => {
        const xs = (r.environments || []).map(e => envColCx.get(e.id)).filter(x => x !== undefined);
        const rx = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length
                             : (idx - (_routers.length - 1) / 2) * NODE_W;
        pos['router_' + r.id] = { x: rx, y: -NODE_H };
      });
      providerNames.forEach((p, i) => {
        pos['provider_' + p] = { x: (i - (providerNames.length - 1) / 2) * NODE_W, y: -2 * NODE_H };
      });
    }
    pos['internet_cloud'] = { x: 0, y: -3 * NODE_H };
  }
  if (_externSrvs.length) {
    const n = _externSrvs.length;
    [..._externSrvs].sort((a, b) => a.hostname.localeCompare(b.hostname))
      .forEach((s, i) => { pos[s.id] = { x: (i - (n - 1) / 2) * NODE_W, y: -4 * NODE_H }; });
  }

  return pos;
}

/**
 * Toggles between physics and hierarchical layout modes, destroying and rebuilding the graph.
 */
export function toggleLayout() {
  setLayoutMode(layoutMode === 'physics' ? 'hierarchical' : 'physics');
  const btn = document.getElementById('layout-toggle-btn');
  btn.innerHTML = layoutMode === 'hierarchical'
    ? '<i class="fa-solid fa-circle-nodes"></i> Physik'
    : '<i class="fa-solid fa-sitemap"></i> Hierarchisch';
  if (network) { network.destroy(); setNetwork(null); setShowingInstances(false); }
  renderGraph();
  applyFilters();
  if (currentServerId) openSidebar(currentServerId);
  else if (currentClusterId) openClusterSidebar(currentClusterId);
}

/**
 * Builds and renders (or patches) the vis-network graph with current data.
 */
export function renderGraph(skipFit = false) {
  const nodeData = allServers.map(buildNode);
  const edgeData = [];

  const isHierG = layoutMode === 'hierarchical';
  allServers.forEach((s, i) => {
    if (!isExternServer(s)) return;
    if (!showInternet) nodeData[i].hidden = true;
    if (!isHierG) { nodeData[i].x = -1700; nodeData[i].y = 0; }
  });

  allRelations.forEach(r => {
    const srcSrv = allServers.find(s => s.id === r.source_id);
    const tgtSrv = allServers.find(s => s.id === r.target_id);
    edgeData.push({
      id: 'sr_' + r.id, from: r.source_id, to: r.target_id,
      arrows: 'to', color: { color: '#4b5563' },
      title: (srcSrv ? srcSrv.hostname : r.source_id) + ' → ' +
             (tgtSrv ? tgtSrv.hostname : r.target_id) + '<br>' + r.type,
    });
  });

  const instMap = buildInstServerMap();
  const srvPairMap = new Map();
  allInstanceRelations.forEach(r => {
    if (r.source_cluster_id || r.target_cluster_id) return;
    const src = instMap[r.source_instance_id];
    const tgt = instMap[r.target_instance_id];
    if (!src || !tgt || !src.serverId || !tgt.serverId || src.serverId === tgt.serverId) return;
    const key = 'ir_srv_' + src.serverId + '_' + tgt.serverId;
    const srcSrv = allServers.find(s => s.id === src.serverId);
    const tgtSrv = allServers.find(s => s.id === tgt.serverId);
    if (!srvPairMap.has(key)) {
      srvPairMap.set(key, { from: src.serverId, to: tgt.serverId, lines: [] });
    }
    srvPairMap.get(key).lines.push(
      src.svcType + ': ' + src.name + ' (' + (srcSrv ? srcSrv.hostname : '?') + ')' +
      ' → ' + tgt.svcType + ': ' + tgt.name + ' (' + (tgtSrv ? tgtSrv.hostname : '?') + ')' +
      '<br><em>' + r.type + '</em>'
    );
  });
  const newIrSrvEdgeIds = [];
  srvPairMap.forEach(({ from, to, lines }, key) => {
    edgeData.push({
      id: key, from, to,
      arrows: 'to', dashes: true,
      color: { color: '#7c3aed' },
      title: lines.join('<hr style="border-color:#334155;margin:5px 0">'),
    });
    newIrSrvEdgeIds.push(key);
  });
  setIrSrvEdgeIds(newIrSrvEdgeIds);

  const { iNodes, iEdges } = buildInternetGraph();
  iNodes.forEach(n => nodeData.push(n));
  iEdges.forEach(e => edgeData.push(e));

  allServers.forEach(s => {
    if (s.gateway_router_id && (layoutMode !== 'hierarchical' || showInternet)) {
      const eid = 'gw_srv_' + s.id;
      const gwR = allRouters.find(r => r.id === s.gateway_router_id);
      edgeData.push({
        id: eid, from: 'router_' + s.gateway_router_id, to: s.id,
        arrows: 'to', width: 1, dashes: [4, 4], physics: false, smooth: { enabled: false },
        color: { color: '#f97316', opacity: 0.65 },
        title: 'Gateway: ' + (gwR ? gwR.name : s.gateway_router_id),
        hidden: !showInternet,
      });
      inetEdgeIds.push(eid);
    } else if (s.gateway_server_id) {
      const eid = 'gw_srv_' + s.id;
      const gwS = allServers.find(sv => sv.id === s.gateway_server_id);
      edgeData.push({
        id: eid, from: s.gateway_server_id, to: s.id,
        arrows: 'to', width: 1, dashes: [4, 4], physics: false, smooth: { enabled: false },
        color: { color: '#22d3ee', opacity: 0.65 },
        title: 'Gateway: ' + (gwS ? gwS.hostname : s.gateway_server_id),
      });
    }
  });

  if (layoutMode === 'hierarchical') {
    const { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges } = buildInstanceNodesEdges();
    instNodes.forEach(n => nodeData.push(n));
    clusterNodes.forEach(n => nodeData.push(n));
    siEdges.forEach(e => edgeData.push(e));
    clusterEdges.forEach(e => edgeData.push(e));
    irInstEdges.forEach(e => edgeData.push(e));
    gwInstEdges.filter(e => !String(e.from).startsWith('router_')).forEach(e => edgeData.push(e));
    const pos = computeHierarchicalPositions();
    nodeData.forEach(n => { if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; n.fixed = true; } });
  }

  if (network && currentRenderedLayout === layoutMode) {
    setShowingInstances(layoutMode === 'hierarchical');
    patchGraph(nodeData, edgeData);
    if (layoutMode === 'hierarchical') {
      irSrvEdgeIds.forEach(id => { if (edges.get(id)) edges.update({ id, hidden: true }); });
    } else {
      updateInstanceVisibility(network.getScale());
    }
    return;
  }
  setCurrentRenderedLayout(layoutMode);

  const { DataSet, Network } = vis;
  setNodes(new DataSet(nodeData));
  setEdges(new DataSet(edgeData));
  const netOpts = layoutMode === 'hierarchical'
    ? {
        physics: { enabled: false },
        interaction: { hover: true, tooltipDelay: 200 },
        edges: { smooth: { enabled: false } },
      }
    : {
        physics: {
          barnesHut: { gravitationalConstant: -3000, centralGravity: 0.3, springLength: 150, damping: 0.09 },
          stabilization: { iterations: 150 },
        },
        interaction: { hover: true, tooltipDelay: 200, maxZoomLevel: 5 },
        edges: { smooth: { enabled: false } },
      };

  // Read the freshly-set nodes/edges from state
  const curNodes = nodes;
  const curEdges = edges;
  const net = new Network(document.getElementById('graph'), { nodes: curNodes, edges: curEdges }, netOpts);
  setNetwork(net);

  if (layoutMode === 'hierarchical') {
    setShowingInstances(true);
    irSrvEdgeIds.forEach(id => { if (curEdges.get(id)) curEdges.update({ id, hidden: true }); });
    net.once('afterDrawing', () => net.fit());
  }

  const graphEl = document.getElementById('graph');
  let leg = document.createElement('div'); leg.id = 'graph-legend';
  graphEl.appendChild(leg);
  renderLegend();

  net.on('beforeDrawing', ctx => {
    if (!showingInstances) return;
    allServers.forEach(server => {
      if (hiddenByFilter.has(server.id)) return;
      const vmInstIds = [];
      (server.services || []).forEach(svc => {
        if (VM_SVC_TYPES.has(svc.type))
          (svc.instances || []).forEach(inst => vmInstIds.push('inst_' + inst.id));
      });
      if (!vmInstIds.length) return;

      const positions = [];
      [server.id, ...vmInstIds].forEach(id => {
        try { positions.push(net.getPosition(id)); } catch (e) {}
      });
      if (positions.length < 2) return;

      const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
      const pad = 48, r = 22;
      const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
      const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
      const col = serverColor(server);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0); ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r); ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + r, y1); ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r); ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 0.40;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.restore();
    });
  });

  net.on('click', params => {
    stopBlink();
    if (!params.nodes.length) return closeSidebar();
    const nodeId = params.nodes[0];
    if (typeof nodeId === 'string' && nodeId.startsWith('cluster_')) {
      openClusterSidebar(parseInt(nodeId.replace('cluster_', '')));
    } else if (typeof nodeId === 'string' && nodeId.startsWith('inst_')) {
      const instId = parseInt(nodeId.replace('inst_', ''));
      const info = buildInstServerMap()[instId];
      if (info) {
        if (info.serverId) openSidebar(info.serverId);
        else if (info.clusterId) openClusterSidebar(info.clusterId);
      }
    } else {
      openSidebar(nodeId);
    }
  });
  net.on('zoom', () => updateInstanceVisibility(net.getScale()));
  net.on('stabilized', () => updateInstanceVisibility(net.getScale()));

  const tooltip = document.getElementById('edge-tooltip');
  net.on('hoverEdge', params => {
    const e = curEdges.get(params.edge);
    if (!e || !e.title) return;
    tooltip.innerHTML = e.title;
    tooltip.style.display = 'block';
  });
  net.on('blurEdge', () => { tooltip.style.display = 'none'; });

  graphEl.addEventListener('mousemove', ev => {
    if (tooltip.style.display === 'none') return;
    const x = ev.clientX + 16;
    const y = ev.clientY + 10;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    tooltip.style.left = (x + tw > window.innerWidth  ? ev.clientX - tw - 8 : x) + 'px';
    tooltip.style.top  = (y + th > window.innerHeight ? ev.clientY - th - 8 : y) + 'px';
  });
}

/** Computes a node's diff signature for cheap change detection in patchGraph. */
function _nodeSignature(n) {
  return n.label + '|' + n.shape + '|' + (n.borderWidth || 1) + '|' +
         JSON.stringify(n.color) + '|' + (n.title || '');
}

/** Computes an edge's diff signature for cheap change detection in patchGraph. */
function _edgeSignature(e) {
  return String(e.from) + '→' + String(e.to) + '|' + (e.title || '') +
         '|' + (e.dashes ? '1' : '0') + '|' + (e.arrows || '');
}

/**
 * Applies a minimal diff to the live vis DataSets, preserving physics positions.
 */
export function patchGraph(newNodeData, newEdgeData) {
  const oldNodeIds = new Set(nodes.getIds().map(String));
  const oldEdgeIds = new Set(edges.getIds().map(String));

  const newNodeMap = new Map(newNodeData.map(n => [String(n.id), n]));
  const newEdgeMap = new Map(newEdgeData.map(e => [String(e.id), e]));

  const removeNodes = [...oldNodeIds].filter(id => !newNodeMap.has(id));
  const removeEdges = [...oldEdgeIds].filter(id => !newEdgeMap.has(id));
  if (removeNodes.length) nodes.remove(removeNodes);
  if (removeEdges.length) edges.remove(removeEdges);

  const addNodes = [], updNodes = [];
  newNodeData.forEach(n => {
    const sid = String(n.id);
    if (!oldNodeIds.has(sid)) {
      addNodes.push(n);
    } else {
      const old = nodes.get(n.id);
      if (!old || _nodeSignature(n) !== _nodeSignature(old)) {
        if (layoutMode === 'physics') {
          const bn = network.body.nodes[n.id];
          if (bn) n = { ...n, x: bn.x, y: bn.y };
        }
        updNodes.push(n);
      }
    }
  });

  const addEdges = [], updEdges = [];
  newEdgeData.forEach(e => {
    const sid = String(e.id);
    if (!oldEdgeIds.has(sid)) {
      addEdges.push(e);
    } else {
      const old = edges.get(e.id);
      if (!old || _edgeSignature(e) !== _edgeSignature(old)) updEdges.push(e);
    }
  });

  if (addNodes.length) nodes.add(addNodes);
  if (updNodes.length) nodes.update(updNodes);
  if (addEdges.length) edges.add(addEdges);
  if (updEdges.length) edges.update(updEdges);

  if (layoutMode === 'physics' && (addNodes.length || removeNodes.length)) {
    network.stabilize(30);
  }
}

/**
 * Shows or hides instance nodes based on current zoom level (physics mode only).
 */
export function updateInstanceVisibility(scale) {
  if (!nodes || !edges || !network) return;
  if (layoutMode === 'hierarchical') return;
  const show = scale >= INST_ZOOM_THRESHOLD;
  if (show === showingInstances) return;
  setShowingInstances(show);

  if (show) {
    const { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges } = buildInstanceNodesEdges();
    nodes.remove(instNodes.map(n => n.id));
    nodes.remove(clusterNodes.map(n => n.id));
    edges.remove(siEdges.map(e => e.id));
    edges.remove(clusterEdges.map(e => e.id));
    edges.remove(irInstEdges.map(e => e.id));
    edges.remove(gwInstEdges.map(e => e.id));
    nodes.add(instNodes);
    nodes.add(clusterNodes);
    edges.add(siEdges);
    edges.add(clusterEdges);
    edges.add(irInstEdges);
    edges.add(gwInstEdges);
    irSrvEdgeIds.forEach(id => { if (edges.get(id)) edges.update({ id, hidden: true }); });
  } else {
    const instNodeIds = [], siEdgeIds = [];
    allServers.forEach(s => (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      instNodeIds.push('inst_' + inst.id);
      siEdgeIds.push('si_' + inst.id);
      edges.remove('gw_inst_' + inst.id);
    })));
    nodes.remove(instNodeIds);
    allClusters.forEach(cl => {
      nodes.remove('cluster_' + cl.id);
      (cl.members || []).forEach(m => edges.remove('cl_member_' + cl.id + '_' + m.id));
    });
    edges.remove(siEdgeIds);
    allInstanceRelations.forEach(r => { edges.remove('ir_inst_' + r.id); });
    irSrvEdgeIds.forEach(id => { if (edges.get(id)) edges.update({ id, hidden: false }); });
  }

  applyFilters(true);
  network.redraw();
  _updateZoomHint(show);
}

/** Updates the zoom-hint overlay inside the graph container. */
function _updateZoomHint(instancesVisible) {
  let hint = document.getElementById('zoom-hint');
  const hasInstances = allServers.some(s => (s.services || []).some(sv => (sv.instances || []).length));
  if (!hasInstances) { if (hint) hint.remove(); return; }
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'zoom-hint';
    hint.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);' +
      'background:rgba(22,33,62,0.85);border:1px solid #0f3460;border-radius:5px;' +
      'padding:5px 14px;font-size:0.75rem;color:#6b7280;pointer-events:none;z-index:10;white-space:nowrap';
    document.getElementById('graph').appendChild(hint);
  }
  hint.textContent = instancesVisible
    ? '🔍 Rauszoomen um Instanzen auszublenden'
    : '🔍 Reinzoomen um Instanzen anzuzeigen';
}

/**
 * Renders or refreshes the graph legend showing present instance service types.
 */
export function renderLegend() {
  const el = document.getElementById('graph-legend');
  if (!el) return;
  const present = new Map();
  allServers.forEach(s => {
    (s.services || []).forEach(svc => {
      if ((svc.instances || []).length && !present.has(svc.type)) {
        present.set(svc.type, {
          color: SVC_COLORS[svc.type] || '#4b5563',
          icon: INST_ICONS[svc.type] || '⚙',
        });
      }
    });
  });
  if (!present.size) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<div class="leg-title">Instanz-Typen</div>' +
    Array.from(present.entries()).map(([type, { color, icon }]) =>
      '<div class="leg-row">' +
      '<span class="leg-dot" style="background:' + color + '"></span>' +
      '<span>' + icon + ' ' + type + '</span></div>'
    ).join('');
}
