/*
 * main.js — application entry point: DOMContentLoaded init, sidebar resizer,
 *           layout toggle wiring, and Excel/GraphML export.
 * Imports and initialises all feature modules.
 */
'use strict';

import { loadAll, initSSE } from './api.js';
import { toggleLayout } from './graph.js';
import { initFilters } from './filters.js';
import { initSidebar } from './sidebar.js';
import { initCluster } from './cluster.js';
import { initSearch } from './search.js';
import { initModals } from './modals.js';

/**
 * Triggers the browser to download the Excel export from the API.
 */
function exportExcel() {
  const a = document.createElement('a');
  a.href = '/api/export/excel';
  a.download = 'systemdocu.xlsx';
  a.click();
}

/**
 * Triggers the browser to download the GraphML export from the API — the
 * full topology (Server/Instanz/Cluster/Umgebung/Anwendung/Anschluss-Knoten
 * plus jede Beziehung dazwischen) as a graph file for tools like yEd, Gephi
 * or Cytoscape.
 */
function exportGraphml() {
  const a = document.createElement('a');
  a.href = '/api/export/graphml';
  a.download = 'systemdocu.graphml';
  a.click();
}

document.addEventListener('DOMContentLoaded', () => {
  // Wire up all module event listeners
  initFilters();
  initSidebar();
  initCluster();
  initSearch();
  initModals();

  // Layout toggle button
  document.getElementById('layout-toggle-btn').addEventListener('click', toggleLayout);

  // Excel / GraphML export buttons
  document.getElementById('btn-export-excel').addEventListener('click', exportExcel);
  document.getElementById('btn-export-graphml').addEventListener('click', exportGraphml);

  // Sidebar resizer
  (function () {
    const resizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('sidebar');
    let dragging = false, startX = 0, startW = 0;

    resizer.addEventListener('mousedown', e => {
      dragging = true;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = startX - e.clientX;
      const newW = Math.min(700, Math.max(280, startW + delta));
      sidebar.style.width = newW + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();

  // Initial data load + SSE connection
  loadAll();
  initSSE();
});
