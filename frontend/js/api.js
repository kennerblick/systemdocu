/*
 * api.js — fetch wrapper, bulk data loader, and SSE client.
 * Exports: api, loadAll, initSSE.
 */
'use strict';

import {
  API,
  allServers, allRelations, allEnvironments, allApplications,
  allInstanceRelations, allRouters, allClusters,
  _lastLoadAll, setLastLoadAll,
  currentServerId, currentClusterId,
} from './state.js';

import { renderGraph, renderLegend } from './graph.js';
import { updateFilters, applyFilters } from './filters.js';
import { checkZabbixStatus } from './utils.js';
import { openSidebar } from './sidebar.js';
import { openClusterSidebar } from './cluster.js';

/**
 * Thin fetch wrapper — sends a JSON request and returns the parsed response body.
 * @param {string} method  HTTP method
 * @param {string} path    API path (appended to /api)
 * @param {*}      [body]  Optional request body (will be JSON-serialised)
 */
export async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return null;
  return r.json();
}

/**
 * Loads all data from the API, re-renders the graph, filters and sidebar.
 * Pass skipFit=true for SSE-triggered reloads to avoid jarring viewport jumps.
 */
export async function loadAll(skipFit = false) {
  // Debounce SSE-triggered reloads that arrive right after a local mutation
  const now = Date.now();
  if (skipFit && now - _lastLoadAll < 600) return;
  setLastLoadAll(now);

  let fresh;
  try {
    fresh = await Promise.all([
      api('GET', '/servers'),
      api('GET', '/relations'),
      api('GET', '/environments'),
      api('GET', '/applications'),
      api('GET', '/instance-relations'),
      api('GET', '/internet-routers'),
      api('GET', '/clusters'),
    ]);
  } catch (e) {
    console.error('loadAll failed:', e);
    return;
  }

  // Mutate shared arrays in place so existing imports keep their references
  const [srvs, rels, envs, apps, instRels, routers, clusters] = fresh;
  allServers.length = 0;       srvs.forEach(x => allServers.push(x));
  allRelations.length = 0;     rels.forEach(x => allRelations.push(x));
  allEnvironments.length = 0;  envs.forEach(x => allEnvironments.push(x));
  allApplications.length = 0;  apps.forEach(x => allApplications.push(x));
  allInstanceRelations.length = 0; instRels.forEach(x => allInstanceRelations.push(x));
  allRouters.length = 0;       routers.forEach(x => allRouters.push(x));
  allClusters.length = 0;      clusters.forEach(x => allClusters.push(x));

  renderGraph(skipFit);
  renderLegend();
  updateFilters();
  applyFilters(skipFit);
  if (currentServerId) openSidebar(currentServerId);
  else if (currentClusterId) openClusterSidebar(currentClusterId);
  checkZabbixStatus();
}

/**
 * Starts an SSE connection for real-time multi-user sync; reconnects on error.
 */
export function initSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('data_changed', () => loadAll(true));
  es.onerror = () => { es.close(); setTimeout(initSSE, 5000); };
}
