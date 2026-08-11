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

import { buildInstServerMap, displayName, escHtml } from './utils.js';
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
 * Returns the native fill color for a server/instance node based on its
 * assigned application(s): white with no application, the application's own
 * color with exactly one, or white again (with a centered multi-color pie
 * drawn on top in beforeDrawing, see drawAppBadge) with several — a single
 * flat vis `color` can't represent more than one color on its own.
 */
function appNodeColor(apps) {
  if (apps.length === 1) return apps[0].color;
  return '#ffffff';
}

/**
 * Draws a small application-color badge at (x,y) with radius r — a solid
 * circle for one application, or evenly-sized pie slices (one per
 * app.color) for several, so multi-app membership reads at a glance.
 */
function drawAppBadge(ctx, x, y, r, apps) {
  if (!apps.length) return;
  ctx.save();
  if (apps.length === 1) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = apps[0].color;
    ctx.fill();
  } else {
    const slice = (Math.PI * 2) / apps.length;
    apps.forEach((app, i) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, i * slice, (i + 1) * slice);
      ctx.closePath();
      ctx.fillStyle = app.color;
      ctx.fill();
    });
  }
  ctx.strokeStyle = '#0a1628';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Gentle "flow toward the gateway" animation on the switch→gateway and
// direct override gateway edges — a slow-shifting dash overlay drawn on top
// of the real (static) edge, since vis-network itself has no animated-dash
// option. One shared ticker for the whole page, started lazily on first
// renderGraph() call.
let _flowPhase = 0;
let _flowAnimStarted = false;

function _ensureFlowAnimation() {
  if (_flowAnimStarted) return;
  _flowAnimStarted = true;
  setInterval(() => {
    _flowPhase += 1;
    // An out-of-band redraw() call while barnesHut stabilization is still
    // actively iterating corrupts the in-progress simulation — free (non-
    // fixed) nodes end up with permanently null/NaN positions. Physics-off
    // (hierarchical) or already-stabilized networks redraw safely.
    if (network && (!network.physics.physicsEnabled || network.physics.stabilized)) network.redraw();
  }, 60);
}

/** Draws a slow-flowing dashed overlay from (x1,y1) to (x2,y2), moving
 * toward the end point (i.e. toward the arrowhead) as `phase` advances. */
function drawFlowOverlay(ctx, x1, y1, x2, y2, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([5, 9]);
  ctx.lineDashOffset = -_flowPhase * 0.4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Builds a vis-network node object for the given server.
 */
export function buildNode(server) {
  const col = appNodeColor(server.applications || []);
  const border = col === '#ffffff' ? '#9ca3af' : col;
  const highlightBorder = col === '#ffffff' ? '#4b5563' : '#ffffff';
  return {
    id: server.id,
    label: displayName(server),
    shape: 'dot',
    size: 18,
    color: { background: col, border, highlight: { background: col, border: highlightBorder } },
    font: { color: '#e0e0e0', size: 13 },
    title: '[' + escHtml(server.os_type) + '] ' + escHtml(server.hostname) +
           (server.common_name ? ' (' + escHtml(server.common_name) + ')' : '') +
           (server.ips && server.ips.length ? '<br>' + server.ips.map(x => escHtml(x.ip)).join('<br>') : '') +
           (server.is_gateway ? '<br>⚡ fungiert als Gateway' : '') +
           (server.gateway_router_id ? '<br>GW: ' + escHtml((allRouters.find(r => r.id === server.gateway_router_id) || {}).name || '?') : '') +
           (server.gateway_server_id ? '<br>GW: ' + escHtml((allServers.find(s => s.id === server.gateway_server_id) || {}).hostname || '?') : ''),
  };
}

/** Builds instance nodes, cluster nodes, and all associated edges for zoomed-in view. */
function buildInstanceNodesEdges() {
  const instNodes = [], siEdges = [], irInstEdges = [], gwInstEdges = [], switchInstEdges = [];
  const im = buildInstServerMap();
  allServers.forEach(s => {
    (s.services || []).forEach(svc => {
      const col = SVC_COLORS[svc.type] || '#4b5563';
      (svc.instances || []).forEach(inst => {
        const gwR = inst.gateway_router_id ? allRouters.find(r => r.id === inst.gateway_router_id) : null;
        const gwS = inst.gateway_server_id ? allServers.find(sv => sv.id === inst.gateway_server_id) : null;
        const gwI = inst.gateway_instance_id ? im[inst.gateway_instance_id] : null;
        const ownAppIds = new Set((inst.applications || []).map(a => a.id));
        const inheritedIds = new Set(s.inherited_application_ids || []);
        const effectiveApps = [
          ...(inst.applications || []),
          ...(s.applications || []).filter(a => inheritedIds.has(a.id) && !ownAppIds.has(a.id)),
        ];
        const nodeCol = appNodeColor(effectiveApps);
        const nodeBorder = nodeCol === '#ffffff' ? '#9ca3af' : nodeCol;
        instNodes.push({
          id: 'inst_' + inst.id,
          label: (inst.is_gateway ? '⚡' : (INST_ICONS[svc.type] || '⚙')) + ' ' + inst.name,
          title: escHtml(inst.name) +
                 '<br>🖥 ' + escHtml(s.hostname) +
                 (inst.is_gateway ? '<br>⚡ fungiert als Gateway' : '') +
                 (inst.ips && inst.ips.length ? '<br>' + inst.ips.map(x => escHtml(x.ip)).join('<br>') : '') +
                 (inst.environments && inst.environments.length
                   ? '<br>🌍 ' + inst.environments.map(e => escHtml(e.name)).join(', ') : '') +
                 (gwR ? '<br>GW: ' + escHtml(gwR.name) : '') +
                 (gwS ? '<br>GW: ' + escHtml(gwS.hostname) : '') +
                 (gwI ? '<br>GW: ' + escHtml(gwI.name) : '') +
                 ((inst.own_services || []).length
                   ? '<br>' + inst.own_services.map(s => (INST_ICONS[s.type] || '⚙') + ' ' + escHtml(s.type) + (s.port ? ':' + s.port : '')).join('  ') : ''),
          shape: 'box',
          color: { background: nodeCol, border: nodeBorder, highlight: { background: nodeCol, border: '#ffffff' } },
          font: { color: nodeCol === '#ffffff' ? '#1f2937' : '#f0f0f0', size: 11 },
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
          title: escHtml(s.hostname) + ' → ' + escHtml(svc.type) + ': ' + escHtml(inst.name),
        });
        (inst.environments || []).forEach(env => {
          switchInstEdges.push({
            id: 'switch_mem_inst_' + inst.id + '_' + env.id, from: 'switch_' + env.id, to: 'inst_' + inst.id,
            arrows: '', dashes: [2, 4], width: 2, length: 110,
            color: { color: env.color, opacity: 0.3 },
            title: 'Quelle: 🔌 ' + escHtml(env.name) + '<br>Ziel: ' + escHtml(s.hostname) + ' / ' + escHtml(inst.name),
          });
        });
        // Same redundancy check as the server-level gw_srv_ edges: skip when
        // the instance's gateway just matches one of its environments'
        // default gateway, since switch_mem_inst_ + switch_gw_ already draw
        // that path via the switch.
        const instMatchesEnvRouter = inst.gateway_router_id &&
          (inst.environments || []).some(e => e.default_gateway_router_id === inst.gateway_router_id);
        const instMatchesEnvServer = inst.gateway_server_id &&
          (inst.environments || []).some(e => e.default_gateway_server_id === inst.gateway_server_id);

        if (inst.gateway_router_id && !instMatchesEnvRouter) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: 'router_' + inst.gateway_router_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 0.75, dashes: [4, 4], smooth: { enabled: false },
            color: { color: '#f97316', opacity: 0.65 },
            title: 'Gateway: ' + escHtml((allRouters.find(r => r.id === inst.gateway_router_id) || {}).name || '?'),
            hidden: !showInternet,
          });
        } else if (inst.gateway_server_id && !instMatchesEnvServer) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: inst.gateway_server_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 0.75, dashes: [4, 4], smooth: { enabled: false },
            color: { color: '#22d3ee', opacity: 0.65 },
            title: 'Gateway: ' + escHtml((allServers.find(sv => sv.id === inst.gateway_server_id) || {}).hostname || '?'),
          });
        } else if (inst.gateway_instance_id) {
          gwInstEdges.push({
            id: 'gw_inst_' + inst.id,
            from: 'inst_' + inst.gateway_instance_id, to: 'inst_' + inst.id,
            arrows: 'to', width: 0.75, dashes: [4, 4], smooth: { enabled: false },
            color: { color: '#22d3ee', opacity: 0.65 },
            title: 'Gateway: ' + escHtml(gwI ? gwI.name : String(inst.gateway_instance_id)),
          });
        }
      });
    });
  });

  const clusterNodes = [];
  const clusterEdges = [];
  allClusters.forEach(cl => {
    const col = SVC_COLORS[cl.service_type] || '#4b5563';
    clusterNodes.push({
      id: 'cluster_' + cl.id,
      label: '◆ ' + cl.name + (cl.domain ? '\n' + cl.domain : ''),
      title: escHtml(cl.name) + ' [' + escHtml(cl.service_type) + ']' +
             (cl.domain ? '<br>🌐 ' + escHtml(cl.domain) : '') +
             (cl.description ? '<br>' + escHtml(cl.description) : '') +
             (cl.members && cl.members.length ? '<br>Mitglieder: ' + cl.members.map(m => escHtml(m.name)).join(', ') : ''),
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
        title: escHtml(cl.name) + ' → ' + escHtml(m.name),
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
    const srcLabel = escHtml(srcCl ? srcCl.name : (src ? src.svcType + ': ' + src.name + ' @ ' + (srcSrv ? srcSrv.hostname : '?') : '?'));
    const tgtLabel = escHtml(tgtCl ? tgtCl.name : (tgt ? tgt.svcType + ': ' + tgt.name + ' @ ' + (tgtSrv ? tgtSrv.hostname : '?') : '?'));
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
             tgtLabel + '<br>' + escHtml(r.type),
    });
  });
  return { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges, switchInstEdges };
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
      color: { color: '#3b82f6' }, hidden });
    newInetEdgeIds.push(eid);
  });

  const n = allRouters.length;
  allRouters.forEach((r, idx) => {
    const titleParts = [];
    if (r.provider)    titleParts.push('Anbieter: ' + escHtml(r.provider));
    if (r.external_ip) titleParts.push('Externe IP: ' + escHtml(r.external_ip));
    if (r.internal_ip) titleParts.push('Interne IP: ' + escHtml(r.internal_ip));
    if (r.server_id) {
      const srv = allServers.find(s => s.id === r.server_id);
      if (srv) titleParts.push('Server: ' + escHtml(srv.hostname));
    }
    if (r.environments && r.environments.length)
      titleParts.push('Netze: ' + r.environments.map(e => escHtml(e.subnet || e.name)).join(', '));

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
      title: titleParts.join('<br>') || escHtml(r.name),
    });
    newInetNodeIds.push(fromNode);

    if (r.server_id) {
      const linkId = 'inet_link_' + r.id;
      iEdges.push({
        id: linkId, from: fromNode, to: r.server_id,
        arrows: 'to', width: 1.5, dashes: [4, 2],
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
      title: r.upstream_router_id ? 'Routing → ' + escHtml(r.name) : escHtml(r.external_ip || 'Anschluss'),
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
 * Builds one "switch" node per Environment (colored by env.color), wired to
 * its member servers and its configured default gateway (router or GW
 * server). Instance-member edges are added separately in
 * buildInstanceNodesEdges() since instance nodes only exist in that pass —
 * this function only needs to know whether an instance member exists at all,
 * to decide whether to render the switch node for an otherwise server-less
 * environment.
 */
function buildEnvironmentSwitches() {
  const swNodes = [], swEdges = [];
  allEnvironments.forEach(env => {
    // "www" isn't a real physical network segment — its members are extern
    // servers sitting directly in front of their router (see isExternServer)
    // — so it gets no switch symbol, unlike every other environment.
    if (env.name.toLowerCase() === 'www') return;
    const memberServers = allServers.filter(s => (s.environments || []).some(e => e.id === env.id));
    const hasGateway = env.default_gateway_router_id || env.default_gateway_server_id;
    const hasInstanceMember = allServers.some(s => (s.services || []).some(svc =>
      (svc.instances || []).some(inst => (inst.environments || []).some(e => e.id === env.id))));
    if (!memberServers.length && !hasInstanceMember && !hasGateway) return;

    const nodeId = 'switch_' + env.id;
    swNodes.push({
      id: nodeId,
      label: '🔌 ' + env.name,
      shape: 'hexagon',
      size: 14,
      color: { background: env.color, border: env.color, highlight: { background: env.color, border: '#fff' } },
      font: { color: '#e0e0e0', size: 11 },
      title: escHtml(env.name) + (env.subnet ? '<br>' + escHtml(env.subnet) : ''),
    });

    memberServers.forEach(s => {
      swEdges.push({
        id: 'switch_mem_srv_' + s.id + '_' + env.id, from: nodeId, to: s.id,
        arrows: '', dashes: [2, 4], width: 2, length: 110,
        color: { color: env.color, opacity: 0.3 },
        title: 'Quelle: 🔌 ' + escHtml(env.name) + '<br>Ziel: ' + escHtml(s.hostname),
      });
    });

    if (env.default_gateway_router_id) {
      const r = allRouters.find(rt => rt.id === env.default_gateway_router_id);
      swEdges.push({
        id: 'switch_gw_' + env.id, from: nodeId, to: 'router_' + env.default_gateway_router_id,
        arrows: 'to', width: 0.75, dashes: [4, 2],
        color: { color: env.color, opacity: 0.75 },
        title: 'Gateway: ' + escHtml(r ? r.name : String(env.default_gateway_router_id)),
      });
    } else if (env.default_gateway_server_id) {
      const gs = allServers.find(sv => sv.id === env.default_gateway_server_id);
      swEdges.push({
        id: 'switch_gw_' + env.id, from: nodeId, to: env.default_gateway_server_id,
        arrows: 'to', width: 0.75, dashes: [4, 2],
        color: { color: env.color, opacity: 0.75 },
        title: 'Gateway: ' + escHtml(gs ? gs.hostname : String(env.default_gateway_server_id)),
      });
    }
  });
  return { swNodes, swEdges };
}

/**
 * Computes fixed x/y positions for all nodes in hierarchical layout mode.
 * Layout reads top-to-bottom per connection: extern/www servers → router →
 * (optional server hosted directly on that router) → one column per
 * environment the router serves → that environment's switch → its
 * servers/instances. Different routers' groups get a wider gap between them
 * than the columns within one group, so the per-connection grouping is
 * visually obvious. Environments not served by any router form their own
 * "no connection" group at the end.
 */
export function computeHierarchicalPositions(opts = {}) {
  const NODE_W = 150, NODE_H = 80, COL_GAP = 70, GROUP_GAP = 160,
        SWITCH_GAP = 55, INST_H = 56, INST_GAP = 18, BELOW_GAP = 70,
        APP_GROUP_GAP = 50,
        // Vertical clearance between the tiers above the server columns:
        // switch → router → www-server → provider → internet cloud. Each is
        // its own gap (rather than a fixed multiple of NODE_H) so hexagon
        // switches, router dots and www-server dots — which aren't NODE_H
        // tall — don't end up close enough to visually overlap.
        ROUTER_GAP = 75, WWW_GAP = 70, PROVIDER_GAP = 70, CLOUD_GAP = 70;
  const pos = {};

  const _servers  = opts.srvFilter  ? allServers.filter(s => opts.srvFilter.has(s.id))   : allServers;
  const _routers  = opts.rtrFilter  ? allRouters.filter(r => !opts.rtrFilter.has(r.id))  : allRouters;
  const _clusters = opts.clFilter   ? allClusters.filter(c => !opts.clFilter.has(c.id))  : allClusters;
  const _instF    = opts.instFilter;

  const _externSrvs = _servers.filter(isExternServer);
  const _colSrvs    = _servers.filter(s => !isExternServer(s));

  const sortByName = arr => [...arr].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const envName    = id => (allEnvironments.find(e => e.id === id) || {}).name || '';

  // Every server becomes a "unit": the server node plus a small grid of its
  // *own* instances (VM or not) directly below it — instances stay next to
  // their actual parent server instead of being pooled into a shared block
  // far away, which made it unclear which instance belonged to which server.
  function serverUnit(s) {
    const instIds = [];
    (s.services || []).forEach(svc => {
      [...(svc.instances || [])].filter(inst => !_instF || _instF.has(inst.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(inst => instIds.push('inst_' + inst.id));
    });
    const cols = instIds.length ? Math.ceil(Math.sqrt(instIds.length)) : 0;
    const rows = instIds.length ? Math.ceil(instIds.length / cols) : 0;
    return {
      server: s, instIds, cols,
      widthUnits: Math.max(1, cols),
      height: NODE_H + (instIds.length ? INST_GAP + rows * INST_H : 0),
    };
  }

  // Servers within a column are sub-grouped by their (first, alphabetically)
  // application so the applications inside one environment render as
  // distinct side-by-side blocks instead of one mixed grid — servers with no
  // application form their own trailing "no application" group.
  function appGroupKey(s) {
    const apps = s.applications || [];
    if (!apps.length) return '__none__';
    return String([...apps].sort((a, b) => a.name.localeCompare(b.name))[0].id);
  }
  function groupByApplication(servers) {
    const groups = new Map(); // key -> { label, servers: [] }
    sortByName(servers).forEach(s => {
      const key = appGroupKey(s);
      if (!groups.has(key)) {
        const apps = s.applications || [];
        const label = apps.length ? [...apps].sort((a, b) => a.name.localeCompare(b.name))[0].name : '';
        groups.set(key, { label, servers: [] });
      }
      groups.get(key).servers.push(s);
    });
    const none = groups.get('__none__');
    groups.delete('__none__');
    const list = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    if (none) list.push(none);
    return list;
  }

  // Packs a flat list of server units into a roughly-square grid, each unit
  // as wide as its own (widest) instance grid — a group with dozens of
  // servers, or one server with dozens of instances, would otherwise become
  // an unreadably tall single-file spike.
  function gridPack(units) {
    if (!units.length) return { gridCols: 0, colWidthPx: 0, rowHeights: [], width: 0, height: 0 };
    const gridCols = Math.ceil(Math.sqrt(units.length));
    const colWidthPx = Math.max(1, ...units.map(u => u.widthUnits)) * NODE_W;
    const rowHeights = [];
    units.forEach((u, i) => {
      const row = Math.floor(i / gridCols);
      rowHeights[row] = Math.max(rowHeights[row] || 0, u.height);
    });
    const height = rowHeights.reduce((a, b) => a + b, 0) + (rowHeights.length - 1) * INST_GAP;
    return { gridCols, colWidthPx, rowHeights, width: gridCols * colWidthPx, height };
  }

  // How many NODE_W-wide slots a column needs: the application sub-groups'
  // packed widths side by side, plus a small gap between them.
  function colWidthUnits(servers) {
    if (!servers.length) return 1;
    const groups = groupByApplication(servers);
    const totalWidthPx = groups.reduce((sum, g, i) => {
      const w = gridPack(g.servers.map(serverUnit)).width;
      return sum + w + (i > 0 ? APP_GROUP_GAP : 0);
    }, 0);
    return Math.max(1, totalWidthPx / NODE_W);
  }

  // ── Which environments have an actual member server in the current
  // (possibly filtered) view — only those get a column at all.
  const envServerMap = new Map();
  const noEnvServers = [];
  sortByName(_colSrvs).forEach(s => {
    const envId = s.environments && s.environments.length ? s.environments[0].id : null;
    if (envId) {
      if (!envServerMap.has(envId)) envServerMap.set(envId, []);
      envServerMap.get(envId).push(s);
    } else {
      noEnvServers.push(s);
    }
  });
  const relevantEnvIds = new Set(envServerMap.keys());

  // ── Group relevant environments by the router that serves them (first
  // router listing it in router.environments "owns" it, matching the
  // server-edit gateway dropdown's own membership convention).
  const envToRouter = new Map();
  _routers.forEach(r => (r.environments || []).forEach(env => {
    if (!envToRouter.has(env.id)) envToRouter.set(env.id, r.id);
  }));

  const groups = []; // { router, envIds: [...], directServerId }
  const groupByRouterId = new Map();
  _routers.forEach(r => {
    const envIds = (r.environments || [])
      .map(e => e.id)
      .filter(id => relevantEnvIds.has(id) && envToRouter.get(id) === r.id)
      .sort((a, b) => envName(a).localeCompare(envName(b)));
    // Only give the router's own server a dedicated column when it has no
    // environment of its own — otherwise it's already placed (once) in its
    // environment's column, and a second column would just duplicate it.
    const hasDirectServer = r.server_id && _colSrvs.some(s =>
      s.id === r.server_id && !(s.environments && s.environments.length));
    if (!envIds.length && !hasDirectServer) return;
    const g = { router: r, envIds, directServerId: hasDirectServer ? r.server_id : null };
    groups.push(g);
    groupByRouterId.set(r.id, g);
  });
  groups.sort((a, b) => a.router.name.localeCompare(b.router.name));

  const groupedEnvIds = new Set();
  groups.forEach(g => g.envIds.forEach(id => groupedEnvIds.add(id)));
  const looseEnvIds = [...relevantEnvIds]
    .filter(id => !groupedEnvIds.has(id))
    .sort((a, b) => envName(a).localeCompare(envName(b)));

  // A server already placed as its router's own direct-server column must
  // not also appear in the generic "no environment" bucket below.
  const directServerIds = new Set(groups.map(g => g.directServerId).filter(Boolean));
  const looseNoEnvServers = noEnvServers.filter(s => !directServerIds.has(s.id));

  // ── Flat column sequence, remembering which group (router id / 'loose' /
  // 'none') each column belongs to, so COL_GAP applies within a group and
  // the wider GROUP_GAP only between different groups.
  const colDefs = [];
  groups.forEach(g => {
    if (g.directServerId) {
      const srv = _colSrvs.find(s => s.id === g.directServerId);
      if (srv) colDefs.push({ envId: null, servers: [srv], colW: NODE_W, groupKey: g.router.id });
    }
    g.envIds.forEach(envId => {
      const servers = envServerMap.get(envId) || [];
      colDefs.push({ envId, servers, colW: colWidthUnits(servers) * NODE_W, groupKey: g.router.id });
    });
  });
  looseEnvIds.forEach(envId => {
    const servers = envServerMap.get(envId) || [];
    colDefs.push({ envId, servers, colW: colWidthUnits(servers) * NODE_W, groupKey: 'loose' });
  });
  if (looseNoEnvServers.length)
    colDefs.push({ envId: null, servers: looseNoEnvServers, colW: colWidthUnits(looseNoEnvServers) * NODE_W, groupKey: 'none' });

  const gapAfter = i => (i >= colDefs.length - 1) ? 0
    : (colDefs[i + 1].groupKey === colDefs[i].groupKey ? COL_GAP : GROUP_GAP);
  const totalW = colDefs.reduce((sum, cd, i) => sum + cd.colW + gapAfter(i), 0);
  let curX = -totalW / 2;
  const envColCx = new Map();
  colDefs.forEach((cd, i) => {
    cd.cx = curX + cd.colW / 2;
    if (cd.envId) envColCx.set(cd.envId, cd.cx);
    curX += cd.colW + gapAfter(i);
  });

  // Environment switches sit between their member column (y=0) and the
  // router tier (y=-NODE_H) — reads top-to-bottom as gateway → switch → members.
  envColCx.forEach((cx, envId) => { pos['switch_' + envId] = { x: cx, y: -SWITCH_GAP }; });

  function placeColumn(servers, cx) {
    const groups = groupByApplication(servers)
      .map(g => ({ units: g.servers.map(serverUnit) }))
      .map(g => ({ ...g, pack: gridPack(g.units) }));
    if (!groups.length) return 0;
    const totalWidthPx = groups.reduce((sum, g, i) => sum + g.pack.width + (i > 0 ? APP_GROUP_GAP : 0), 0);
    let gx = cx - totalWidthPx / 2;
    let maxHeight = 0;
    groups.forEach(g => {
      const gcx = gx + g.pack.width / 2;
      const { gridCols, colWidthPx, rowHeights } = g.pack;
      let y = 0;
      for (let row = 0; row * gridCols < g.units.length; row++) {
        const rowUnits = g.units.slice(row * gridCols, row * gridCols + gridCols);
        rowUnits.forEach((u, colIdx) => {
          const ux = gcx + (colIdx - (gridCols - 1) / 2) * colWidthPx;
          pos[u.server.id] = { x: ux, y };
          u.instIds.forEach((instId, vi) => {
            pos[instId] = {
              x: ux + (vi % u.cols - (u.cols - 1) / 2) * NODE_W,
              y: y + NODE_H + INST_GAP + Math.floor(vi / u.cols) * INST_H,
            };
          });
        });
        y += rowHeights[row] + INST_GAP;
      }
      maxHeight = Math.max(maxHeight, y - INST_GAP);
      gx += g.pack.width + APP_GROUP_GAP;
    });
    return maxHeight;
  }

  let maxColH = 0;
  colDefs.forEach(cd => { maxColH = Math.max(maxColH, placeColumn(cd.servers, cd.cx)); });

  let y = maxColH + BELOW_GAP;
  const placeGrid = (ids, startY, rowH) => {
    if (!ids.length) return 0;
    const cols = Math.ceil(Math.sqrt(ids.length));
    ids.forEach((id, i) => {
      pos[id] = { x: (i % cols - (cols - 1) / 2) * NODE_W, y: startY + Math.floor(i / cols) * rowH };
    });
    return Math.ceil(ids.length / cols) * rowH;
  };
  const clusterIds = _clusters.map(c => 'cluster_' + c.id);
  if (clusterIds.length) { y += placeGrid(clusterIds, y, NODE_H) + BELOW_GAP; }

  // ── Switches for environments with no server-member column (only
  // instance members, or only a configured gateway and no members at all
  // in the current view) still need a position — without this they'd stay
  // wherever vis last put them (usually near the origin), disconnected
  // from their actual members/gateway. Group them in their own small row.
  const positionedEnvIds = new Set(envColCx.keys());
  const fallbackSwitchEnvs = allEnvironments
    .filter(env => env.name.toLowerCase() !== 'www')
    .filter(env => !positionedEnvIds.has(env.id))
    .filter(env => {
      const hasInstMember = _servers.some(s => (s.services || []).some(svc =>
        (svc.instances || []).some(inst => (!_instF || _instF.has(inst.id)) &&
          (inst.environments || []).some(e => e.id === env.id))));
      return hasInstMember || env.default_gateway_router_id || env.default_gateway_server_id;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (fallbackSwitchEnvs.length) {
    y += BELOW_GAP;
    y += placeGrid(fallbackSwitchEnvs.map(env => 'switch_' + env.id), y, NODE_H * 0.6);
  }

  // ── Routers: centered over their own group's column span (not an
  // average across possibly-distant environments), so a router always sits
  // exactly above its own children. Routers with no relevant group in the
  // current (possibly filtered) view fall back to a plain row.
  const routerY = -(SWITCH_GAP + ROUTER_GAP);
  const wwwY = routerY - WWW_GAP;
  const providerY = wwwY - PROVIDER_GAP;
  const cloudY = providerY - CLOUD_GAP;

  if (_routers.length || _externSrvs.length) {
    if (_routers.length) {
      const rootRouters   = _routers.filter(r => !r.upstream_router_id);
      const providerNames = [...new Set(rootRouters.filter(r => r.provider).map(r => r.provider))];
      const looseRouters  = _routers.filter(r => !groupByRouterId.has(r.id));
      let looseIdx = 0;
      _routers.forEach(r => {
        const g = groupByRouterId.get(r.id);
        let rx;
        if (g) {
          const cols = colDefs.filter(cd => cd.groupKey === r.id);
          rx = (cols[0].cx + cols[cols.length - 1].cx) / 2;
        } else {
          rx = (looseIdx - (looseRouters.length - 1) / 2) * NODE_W;
          looseIdx += 1;
        }
        pos['router_' + r.id] = { x: rx, y: routerY };
      });
      providerNames.forEach((p, i) => {
        pos['provider_' + p] = { x: (i - (providerNames.length - 1) / 2) * NODE_W, y: providerY };
      });
    }
    pos['internet_cloud'] = { x: 0, y: cloudY };
  }

  // ── www/extern servers: placed directly above their own gateway router
  // when determinable, remaining ones in a global fallback row up top — both
  // share the same www tier (between the router and provider tiers) so they
  // don't collide with either.
  if (_externSrvs.length) {
    const byRouter = new Map();
    const fallback = [];
    _externSrvs.forEach(s => {
      if (s.gateway_router_id && pos['router_' + s.gateway_router_id]) {
        if (!byRouter.has(s.gateway_router_id)) byRouter.set(s.gateway_router_id, []);
        byRouter.get(s.gateway_router_id).push(s);
      } else {
        fallback.push(s);
      }
    });
    byRouter.forEach((srvs, routerId) => {
      const rPos = pos['router_' + routerId];
      const n = srvs.length;
      sortByName(srvs).forEach((s, i) => {
        pos[s.id] = { x: rPos.x + (i - (n - 1) / 2) * NODE_W, y: wwwY };
      });
    });
    if (fallback.length) {
      const n = fallback.length;
      sortByName(fallback).forEach((s, i) => {
        pos[s.id] = { x: (i - (n - 1) / 2) * NODE_W, y: wwwY };
      });
    }
  }

  return pos;
}

/**
 * Fits the viewport to only the currently visible (non-hidden) nodes.
 * vis-network's own fit() includes hidden nodes' positions in its bounding-box
 * calculation, which leaves large empty margins whenever a filter or the
 * internet toggle hides part of the graph — passing an explicit node list works
 * around that.
 */
export function fitVisible(animate = true) {
  if (!network || !nodes) return;
  const visibleIds = nodes.get().filter(n => !n.hidden).map(n => n.id);
  if (!visibleIds.length) return;
  network.fit({
    nodes: visibleIds,
    animation: animate ? { duration: 300, easingFunction: 'easeInOutQuad' } : false,
  });
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
  let externIdx = 0;
  allServers.forEach((s, i) => {
    if (!isExternServer(s)) return;
    if (!showInternet) { nodeData[i].hidden = true; nodeData[i].physics = false; }
    // Spread multiple extern servers out instead of stacking them on one
    // identical coordinate — barnesHut repulsion divides by the distance
    // between two nodes, and several free (non-fixed) nodes spawning at the
    // exact same point produces a division-by-zero whose NaN cascades
    // through the shared quadtree and corrupts the *entire* simulation,
    // including completely unrelated nodes.
    if (!isHierG) { nodeData[i].x = -1700 + (externIdx % 5) * 90; nodeData[i].y = Math.floor(externIdx / 5) * 90; externIdx++; }
  });

  allRelations.forEach(r => {
    const srcSrv = allServers.find(s => s.id === r.source_id);
    const tgtSrv = allServers.find(s => s.id === r.target_id);
    edgeData.push({
      id: 'sr_' + r.id, from: r.source_id, to: r.target_id,
      arrows: 'to', color: { color: '#4b5563' },
      title: escHtml(srcSrv ? srcSrv.hostname : String(r.source_id)) + ' → ' +
             escHtml(tgtSrv ? tgtSrv.hostname : String(r.target_id)) + '<br>' + escHtml(r.type),
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
      escHtml(src.svcType + ': ' + src.name + ' (' + (srcSrv ? srcSrv.hostname : '?') + ')' +
      ' → ' + tgt.svcType + ': ' + tgt.name + ' (' + (tgtSrv ? tgtSrv.hostname : '?') + ')') +
      '<br><em>' + escHtml(r.type) + '</em>'
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

  const { swNodes, swEdges } = buildEnvironmentSwitches();
  swNodes.forEach(n => nodeData.push(n));
  swEdges.forEach(e => edgeData.push(e));

  allServers.forEach(s => {
    // Skip the direct gateway edge when it just matches one of the server's
    // environments' own default gateway — that path is already drawn via
    // switch_mem_srv_ + switch_gw_ (server → switch → gateway). Only a
    // deliberate per-server override (differing from the env default) still
    // gets its own direct arrow.
    const matchesEnvDefaultRouter = s.gateway_router_id &&
      (s.environments || []).some(e => e.default_gateway_router_id === s.gateway_router_id);
    const matchesEnvDefaultServer = s.gateway_server_id &&
      (s.environments || []).some(e => e.default_gateway_server_id === s.gateway_server_id);

    if (s.gateway_router_id && !matchesEnvDefaultRouter && (layoutMode !== 'hierarchical' || showInternet)) {
      const eid = 'gw_srv_' + s.id;
      const gwR = allRouters.find(r => r.id === s.gateway_router_id);
      edgeData.push({
        id: eid, from: 'router_' + s.gateway_router_id, to: s.id,
        arrows: 'to', width: 0.75, dashes: [4, 4], smooth: { enabled: false },
        color: { color: '#f97316', opacity: 0.65 },
        title: 'Gateway: ' + escHtml(gwR ? gwR.name : String(s.gateway_router_id)),
        hidden: !showInternet,
      });
      inetEdgeIds.push(eid);
    } else if (s.gateway_server_id && !matchesEnvDefaultServer) {
      const eid = 'gw_srv_' + s.id;
      const gwS = allServers.find(sv => sv.id === s.gateway_server_id);
      edgeData.push({
        id: eid, from: s.gateway_server_id, to: s.id,
        arrows: 'to', width: 0.75, dashes: [4, 4], smooth: { enabled: false },
        color: { color: '#22d3ee', opacity: 0.65 },
        title: 'Gateway: ' + escHtml(gwS ? gwS.hostname : String(s.gateway_server_id)),
      });
    }
  });

  if (layoutMode === 'hierarchical') {
    const { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges, switchInstEdges } = buildInstanceNodesEdges();
    instNodes.forEach(n => nodeData.push(n));
    clusterNodes.forEach(n => nodeData.push(n));
    siEdges.forEach(e => edgeData.push(e));
    clusterEdges.forEach(e => edgeData.push(e));
    irInstEdges.forEach(e => edgeData.push(e));
    switchInstEdges.forEach(e => edgeData.push(e));
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
          barnesHut: {
            gravitationalConstant: -12000,
            centralGravity: 0.15,
            springLength: 220,
            springConstant: 0.03,
            damping: 0.15,
            avoidOverlap: 0.6,
          },
          stabilization: { iterations: 400, fit: true },
        },
        interaction: { hover: true, tooltipDelay: 200, maxZoomLevel: 5 },
        edges: { smooth: { enabled: false } },
      };

  // Read the freshly-set nodes/edges from state
  const curNodes = nodes;
  const curEdges = edges;
  const net = new Network(document.getElementById('graph'), { nodes: curNodes, edges: curEdges }, netOpts);
  setNetwork(net);
  _ensureFlowAnimation();

  if (layoutMode === 'hierarchical') {
    setShowingInstances(true);
    irSrvEdgeIds.forEach(id => { if (curEdges.get(id)) curEdges.update({ id, hidden: true }); });
    net.once('afterDrawing', () => fitVisible(false));
  }

  const graphEl = document.getElementById('graph');
  let leg = document.createElement('div'); leg.id = 'graph-legend';
  graphEl.appendChild(leg);
  renderLegend();

  net.on('beforeDrawing', ctx => {
    // Multi-application servers get a native white fill (a flat vis `color`
    // can't show more than one color), so draw the real pie-slice breakdown
    // centered on top — drawn regardless of zoom/instance-visibility state,
    // since server nodes exist in both.
    allServers.forEach(server => {
      if (hiddenByFilter.has(server.id)) return;
      const apps = server.applications || [];
      if (apps.length < 2) return;
      let pos;
      try { pos = net.getPosition(server.id); } catch (e) { return; }
      drawAppBadge(ctx, pos.x, pos.y, 16, apps);
    });

    if (!showingInstances) return;

    // Same for multi-application instance boxes — effective apps = the
    // instance's own applications plus whichever of its server's tags opted
    // into inherit_to_instances (server.inherited_application_ids).
    allServers.forEach(server => {
      if (hiddenByFilter.has(server.id)) return;
      const inheritedIds = new Set(server.inherited_application_ids || []);
      const inheritedApps = (server.applications || []).filter(a => inheritedIds.has(a.id));
      (server.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
        const ownIds = new Set((inst.applications || []).map(a => a.id));
        const effective = [...(inst.applications || []), ...inheritedApps.filter(a => !ownIds.has(a.id))];
        if (effective.length < 2) return;
        const n = nodes.get('inst_' + inst.id);
        if (!n || n.hidden) return;
        let pos;
        try { pos = net.getPosition('inst_' + inst.id); } catch (e) { return; }
        drawAppBadge(ctx, pos.x, pos.y, 8, effective);
      }));
    });

    const visibleServerPositions = [];
    allServers.forEach(s => {
      if (hiddenByFilter.has(s.id)) return;
      try { visibleServerPositions.push({ id: s.id, pos: net.getPosition(s.id) }); } catch (e) {}
    });

    allServers.forEach(server => {
      if (hiddenByFilter.has(server.id)) return;
      const vmInstIds = [];
      (server.services || []).forEach(svc => {
        if (VM_SVC_TYPES.has(svc.type))
          (svc.instances || []).forEach(inst => vmInstIds.push('inst_' + inst.id));
      });
      if (!vmInstIds.length) return;

      let serverPos;
      try { serverPos = net.getPosition(server.id); } catch (e) { return; }

      const instPositions = [];
      vmInstIds.forEach(id => {
        try { instPositions.push(net.getPosition(id)); } catch (e) {}
      });
      if (!instPositions.length) return;

      // Drop instances the physics simulation drifted far away from their own
      // server, so a single stray VM doesn't balloon the frame across the canvas.
      const dists = instPositions.map(p => Math.hypot(p.x - serverPos.x, p.y - serverPos.y));
      const sortedDists = [...dists].sort((a, b) => a - b);
      const mid = Math.floor(sortedDists.length / 2);
      const median = sortedDists.length % 2 ? sortedDists[mid] : (sortedDists[mid - 1] + sortedDists[mid]) / 2;
      const maxReasonable = Math.max(200, 2.5 * median);
      const kept = instPositions.filter((p, i) => dists[i] <= maxReasonable);
      if (!kept.length) return;

      const positions = [serverPos, ...kept];
      const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
      const pad = 48, r = 22;
      const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
      const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;

      // Skip drawing if another server's node ends up inside this box — the
      // free-form physics layout doesn't otherwise guarantee it's excluded,
      // and a frame around an unrelated server would be misleading.
      const foreignServerInside = visibleServerPositions.some(({ id, pos }) =>
        id !== server.id && pos.x > x0 && pos.x < x1 && pos.y > y0 && pos.y < y1);
      if (foreignServerInside) return;

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

  net.on('afterDrawing', ctx => {
    edges.forEach(e => {
      const id = e.id;
      if (typeof id !== 'string') return;
      // switch_gw_ points switch → gateway (gateway = e.to), but gw_srv_/
      // gw_inst_ point gateway → dependent (gateway = e.from) — the flow
      // must always drift toward whichever endpoint is the actual gateway.
      let sourceId, gatewayId;
      if (id.startsWith('switch_gw_')) { sourceId = e.from; gatewayId = e.to; }
      else if (id.startsWith('gw_srv_') || id.startsWith('gw_inst_')) { sourceId = e.to; gatewayId = e.from; }
      else return;
      if (e.hidden) return;
      let p1, p2;
      try { p1 = net.getPosition(sourceId); p2 = net.getPosition(gatewayId); } catch (err) { return; }
      const col = (e.color && e.color.color) || '#f97316';
      drawFlowOverlay(ctx, p1.x, p1.y, p2.x, p2.y, col);
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
  // Includes x/y so a hierarchical-mode re-layout (nodeData carries fixed
  // x/y there) still updates a node whose other visuals didn't change —
  // otherwise patchGraph() would leave it at its old position after e.g. an
  // SSE-triggered reload that only changed unrelated nodes' layout.
  return n.label + '|' + n.shape + '|' + (n.borderWidth || 1) + '|' +
         JSON.stringify(n.color) + '|' + (n.title || '') + '|' +
         (n.x !== undefined ? n.x.toFixed(1) : '') + '|' + (n.y !== undefined ? n.y.toFixed(1) : '');
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
  const oldNodeIdsRaw = nodes.getIds();
  const oldEdgeIdsRaw = edges.getIds();
  const oldNodeIds = new Set(oldNodeIdsRaw.map(String));
  const oldEdgeIds = new Set(oldEdgeIdsRaw.map(String));

  const newNodeMap = new Map(newNodeData.map(n => [String(n.id), n]));
  const newEdgeMap = new Map(newEdgeData.map(e => [String(e.id), e]));

  // DataSet.remove() requires ids in their original (stored) type — a
  // stringified numeric server id silently fails to match, so removal must
  // use the untouched raw ids, not the stringified sets used for the diff.
  const removeNodes = oldNodeIdsRaw.filter(id => !newNodeMap.has(String(id)));
  const removeEdges = oldEdgeIdsRaw.filter(id => !newEdgeMap.has(String(id)));
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
    const { instNodes, clusterNodes, clusterEdges, siEdges, irInstEdges, gwInstEdges, switchInstEdges } = buildInstanceNodesEdges();
    nodes.remove(instNodes.map(n => n.id));
    nodes.remove(clusterNodes.map(n => n.id));
    edges.remove(siEdges.map(e => e.id));
    edges.remove(clusterEdges.map(e => e.id));
    edges.remove(irInstEdges.map(e => e.id));
    edges.remove(gwInstEdges.map(e => e.id));
    edges.remove(switchInstEdges.map(e => e.id));
    nodes.add(instNodes);
    nodes.add(clusterNodes);
    edges.add(siEdges);
    edges.add(clusterEdges);
    edges.add(irInstEdges);
    edges.add(gwInstEdges);
    edges.add(switchInstEdges);
    irSrvEdgeIds.forEach(id => { if (edges.get(id)) edges.update({ id, hidden: true }); });
  } else {
    const instNodeIds = [], siEdgeIds = [];
    allServers.forEach(s => (s.services || []).forEach(svc => (svc.instances || []).forEach(inst => {
      instNodeIds.push('inst_' + inst.id);
      siEdgeIds.push('si_' + inst.id);
      edges.remove('gw_inst_' + inst.id);
      (inst.environments || []).forEach(env => edges.remove('switch_mem_inst_' + inst.id + '_' + env.id));
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
  if (!present.size && !allEnvironments.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  const svcSection = present.size
    ? '<div class="leg-title">Instanz-Typen</div>' +
      Array.from(present.entries()).map(([type, { color, icon }]) =>
        '<div class="leg-row">' +
        '<span class="leg-dot" style="background:' + color + '"></span>' +
        '<span>' + icon + ' ' + escHtml(type) + '</span></div>'
      ).join('')
    : '';
  const envSection = allEnvironments.length
    ? '<div class="leg-title">Umgebungen</div>' +
      allEnvironments.map(env =>
        '<div class="leg-row">' +
        '<span class="leg-dot" style="background:' + env.color + '"></span>' +
        '<span>🔌 ' + escHtml(env.name) + '</span></div>'
      ).join('')
    : '';
  el.innerHTML = svcSection + envSection;
}
