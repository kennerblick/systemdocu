/*
 * state.js — global state variables and constants for systemdocu.
 * No imports. All other modules import from here.
 */
'use strict';

export const API = '/api';

// vis-network DataSet/Network instances — use setters from graph.js consumers
export let network = null;
export let nodes = null;
export let edges = null;

/** Set the vis Network instance (called from graph.js after creation). */
export function setNetwork(n) { network = n; }
/** Set the vis nodes DataSet (called from graph.js after creation). */
export function setNodes(n) { nodes = n; }
/** Set the vis edges DataSet (called from graph.js after creation). */
export function setEdges(e) { edges = e; }

// Domain data — mutated in place after API loads (export const so const arrays can be mutated)
export const allServers = [];
export const allRelations = [];
export const allEnvironments = [];
export const allApplications = [];
export const allInstanceRelations = [];
export const allRouters = [];
export const allClusters = [];

// Layout state
export let layoutMode = 'physics';
/** Update the current layout mode string. */
export function setLayoutMode(m) { layoutMode = m; }

export let currentRenderedLayout = null;
/** Update the currentRenderedLayout string. */
export function setCurrentRenderedLayout(m) { currentRenderedLayout = m; }

export let irSrvEdgeIds = [];
/** Replace the irSrvEdgeIds array contents. */
export function setIrSrvEdgeIds(ids) { irSrvEdgeIds.length = 0; ids.forEach(id => irSrvEdgeIds.push(id)); }

// Blink animation state
export let _blinkTimer = null;
export let _blinkNodeId = null;
export let _blinkOrigColor = null;
/** Set blink animation state. */
export function setBlinkState(timer, nodeId, origColor) {
  _blinkTimer = timer;
  _blinkNodeId = nodeId;
  _blinkOrigColor = origColor;
}

// Search state
export let _searchResults = [];
export let _searchIdx = -1;
/** Update search results array and index. */
export function setSearchState(results, idx) {
  _searchResults.length = 0;
  results.forEach(r => _searchResults.push(r));
  _searchIdx = idx;
}
/** Update only the search highlight index. */
export function setSearchIdx(idx) { _searchIdx = idx; }

// Internet / filter state
export let inetNodeIds = [];
export let inetEdgeIds = [];
/** Replace inetNodeIds contents. */
export function setInetNodeIds(ids) { inetNodeIds.length = 0; ids.forEach(id => inetNodeIds.push(id)); }
/** Replace inetEdgeIds contents. */
export function setInetEdgeIds(ids) { inetEdgeIds.length = 0; ids.forEach(id => inetEdgeIds.push(id)); }

export let showInternet = false;
/** Set the showInternet flag. */
export function setShowInternet(v) { showInternet = v; }

export let hiddenByFilter = new Set();
/** Replace the hiddenByFilter Set. */
export function setHiddenByFilter(s) { hiddenByFilter = s; }

// Sidebar state
export let currentServerId = null;
export let currentClusterId = null;
/** Set the currently open server sidebar ID. */
export function setCurrentServerId(id) { currentServerId = id; }
/** Set the currently open cluster sidebar ID. */
export function setCurrentClusterId(id) { currentClusterId = id; }

// Instance visibility
export let showingInstances = false;
/** Set the showingInstances flag. */
export function setShowingInstances(v) { showingInstances = v; }

// OS and service colour maps
export const OS_COLORS = {
  linux:   '#3b82f6',
  windows: '#60a5fa',
  proxmox: '#f97316',
  esxi:    '#22c55e',
};

export const SVC_COLORS = {
  postgresql:'#336791', docker:'#2496ed', kubernetes:'#326ce5',
  hyperv:'#00adef', proxmox:'#E57000', samba:'#d97706', nfs:'#b45309', sftp:'#059669',
  freeipa:'#7c3aed', zabbix:'#e53e3e', graylog:'#2d3748',
  veeam:'#00b050', minio:'#c83b0e', gateway:'#0d9488', webserver:'#0ea5e9',
  mqtt:'#660066',
};

// Instances of these service types represent VMs with their own IP addresses
export const VM_SVC_TYPES = new Set(['hyperv', 'esxi', 'proxmox']);

// Instances of these services get full controls (net + app + service dropdowns)
export const FULL_INST_TYPES = new Set(['kubernetes', 'hyperv', 'docker', 'proxmox', 'esxi']);

// Instances of these service types always inherit the host server's environments
export const HOST_ENV_SVC_TYPES = new Set(['webserver', 'postgresql', 'sftp', 'samba', 'nfs', 'mqtt']);

export const isExternServer = s => (s.environments || []).some(e => e.name.toLowerCase() === 'www');

export const INST_ZOOM_THRESHOLD = 0.65;

export const INST_ICONS = {
  postgresql: '🗄', docker: '🐳', kubernetes: '☸', hyperv: '🖥', proxmox: '🖧',
  samba: '📁', nfs: '🗂', sftp: '📂', freeipa: '🔑', zabbix: '📊',
  graylog: '📝', veeam: '💾', minio: '🪣', gateway: '🔀', webserver: '🌐',
  mqtt: '📨',
};

export const INST_SVC_TYPES = [
  'postgresql','mysql','webserver','mqtt','samba','nfs','sftp','freeipa',
  'zabbix','graylog','veeam','minio','gateway',
];

export const AUTO_COLORS = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1',
  '#14b8a6','#eab308','#a855f7','#0ea5e9','#22c55e',
];

// Internal debounce timestamp for loadAll
export let _lastLoadAll = 0;
/** Update the last-loadAll timestamp. */
export function setLastLoadAll(ts) { _lastLoadAll = ts; }

// Zabbix scan result cached between scan and import steps
export let zbxScanData = null;
/** Set zabbix scan result payload. */
export function setZbxScanData(d) { zbxScanData = d; }
