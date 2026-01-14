import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

// State
let pages = [];
let selectedPages = new Set();
let draggedIndex = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const toolbar = document.getElementById('toolbar');
const pageGrid = document.getElementById('pageGrid');
const progressOverlay = document.getElementById('progressOverlay');
const progressText = document.getElementById('progressText');

// Toolbar buttons
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectBtn = document.getElementById('deselectBtn');
const rotateCWBtn = document.getElementById('rotateCWBtn');
const deleteBtn = document.getElementById('deleteBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');

// Initialize
init();

function init() {
  setupDropZone();
  setupToolbar();
  loadPreferences();
}

function setupDropZone() {
  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
    if (files.length > 0) {
      await loadPDFs(files);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      await loadPDFs(files);
    }
    fileInput.value = '';
  });
}

function setupToolbar() {
  selectAllBtn.addEventListener('click', selectAll);
  deselectBtn.addEventListener('click', deselectAll);
  rotateCWBtn.addEventListener('click', rotateSelected);
  deleteBtn.addEventListener('click', deleteSelected);
  clearBtn.addEventListener('click', clearAll);
  downloadBtn.addEventListener('click', downloadMerged);
}

function showProgress(text) {
  progressText.textContent = text;
  progressOverlay.classList.remove('hidden');
}

function hideProgress() {
  progressOverlay.classList.add('hidden');
}

async function loadPDFs(files) {
  showProgress('Loading PDFs...');

  try {
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const pdfBytes = new Uint8Array(arrayBuffer);

      // Load with pdf-lib for manipulation
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pageCount = pdfDoc.getPageCount();

      // Load with PDF.js for rendering
      const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
      const pdfJsDoc = await loadingTask.promise;

      for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.getPage(i);
        const pdfJsPage = await pdfJsDoc.getPage(i + 1);

        pages.push({
          id: crypto.randomUUID(),
          sourceFile: file.name,
          sourcePageIndex: i,
          pdfBytes: pdfBytes,
          rotation: 0,
          pdfJsPage: pdfJsPage
        });
      }
    }

    updateUI();
    await renderThumbnails();
  } catch (error) {
    console.error('Error loading PDFs:', error);
    alert('Error loading PDF files. Please make sure they are valid PDF documents.');
  } finally {
    hideProgress();
  }
}

function updateUI() {
  const hasPages = pages.length > 0;

  if (hasPages) {
    dropZone.classList.add('hidden');
    toolbar.classList.remove('hidden');
    pageGrid.classList.remove('hidden');
  } else {
    dropZone.classList.remove('hidden');
    toolbar.classList.add('hidden');
    pageGrid.classList.add('hidden');
  }

  updateToolbarState();
}

function updateToolbarState() {
  const hasSelection = selectedPages.size > 0;
  deselectBtn.disabled = !hasSelection;
  rotateCWBtn.disabled = !hasSelection;
  deleteBtn.disabled = !hasSelection;
}

async function renderThumbnails() {
  pageGrid.innerHTML = '';

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const card = createPageCard(page, i);
    pageGrid.appendChild(card);

    // Render thumbnail
    await renderPageThumbnail(page, card.querySelector('canvas'));
  }
}

function createPageCard(page, index) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.index = index;
  card.draggable = true;

  if (selectedPages.has(page.id)) {
    card.classList.add('selected');
  }

  card.innerHTML = `
    <div class="page-checkbox">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>
    ${page.rotation !== 0 ? `<div class="rotation-badge">${page.rotation}°</div>` : ''}
    <div class="page-thumbnail">
      <canvas></canvas>
    </div>
    <div class="page-info">
      <span class="page-number">Page ${index + 1}</span>
      <span class="page-source" title="${page.sourceFile}">${page.sourceFile}</span>
    </div>
  `;

  // Click to select
  card.addEventListener('click', (e) => {
    if (e.target.closest('.page-checkbox')) {
      toggleSelection(page.id);
    } else {
      // Click on card toggles selection
      toggleSelection(page.id);
    }
  });

  // Drag and drop for reordering
  card.addEventListener('dragstart', (e) => {
    draggedIndex = index;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedIndex = null;
    document.querySelectorAll('.page-card').forEach(c => c.classList.remove('drag-over'));
  });

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      card.classList.add('drag-over');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');

    if (draggedIndex !== null && draggedIndex !== index) {
      reorderPages(draggedIndex, index);
    }
  });

  return card;
}

async function renderPageThumbnail(page, canvas) {
  const pdfJsPage = page.pdfJsPage;
  const scale = 0.5;
  const viewport = pdfJsPage.getViewport({ scale, rotation: page.rotation });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext('2d');

  await pdfJsPage.render({
    canvasContext: context,
    viewport: viewport
  }).promise;
}

function toggleSelection(pageId) {
  if (selectedPages.has(pageId)) {
    selectedPages.delete(pageId);
  } else {
    selectedPages.add(pageId);
  }

  updatePageCards();
  updateToolbarState();
}

function updatePageCards() {
  document.querySelectorAll('.page-card').forEach((card, index) => {
    const page = pages[index];
    if (selectedPages.has(page.id)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
}

function selectAll() {
  pages.forEach(page => selectedPages.add(page.id));
  updatePageCards();
  updateToolbarState();
}

function deselectAll() {
  selectedPages.clear();
  updatePageCards();
  updateToolbarState();
}

async function rotateSelected() {
  const selectedList = pages.filter(p => selectedPages.has(p.id));

  for (const page of selectedList) {
    page.rotation = (page.rotation + 90) % 360;
  }

  await renderThumbnails();
  savePreferences();
}

function deleteSelected() {
  pages = pages.filter(p => !selectedPages.has(p.id));
  selectedPages.clear();

  if (pages.length === 0) {
    updateUI();
  } else {
    renderThumbnails();
  }

  updateToolbarState();
}

function clearAll() {
  pages = [];
  selectedPages.clear();
  updateUI();
}

function reorderPages(fromIndex, toIndex) {
  const [movedPage] = pages.splice(fromIndex, 1);
  pages.splice(toIndex, 0, movedPage);
  renderThumbnails();
}

async function downloadMerged() {
  if (pages.length === 0) return;

  showProgress('Creating PDF...');

  try {
    const mergedPdf = await PDFDocument.create();

    // Group pages by source file for efficiency
    const pagesBySource = new Map();
    pages.forEach((page, index) => {
      const key = page.sourceFile + '-' + page.pdfBytes.length;
      if (!pagesBySource.has(key)) {
        pagesBySource.set(key, { bytes: page.pdfBytes, pages: [] });
      }
      pagesBySource.get(key).pages.push({ page, index });
    });

    // Process each source document
    const copiedPages = [];

    for (const [key, data] of pagesBySource) {
      const srcDoc = await PDFDocument.load(data.bytes);

      for (const { page, index } of data.pages) {
        const [copiedPage] = await mergedPdf.copyPages(srcDoc, [page.sourcePageIndex]);

        // Apply rotation
        if (page.rotation !== 0) {
          copiedPage.setRotation(degrees(copiedPage.getRotation().angle + page.rotation));
        }

        copiedPages[index] = copiedPage;
      }
    }

    // Add pages in order
    for (const page of copiedPages) {
      mergedPdf.addPage(page);
    }

    progressText.textContent = 'Saving PDF...';
    const pdfBytes = await mergedPdf.save();

    // Download
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error creating PDF:', error);
    alert('Error creating PDF. Please try again.');
  } finally {
    hideProgress();
  }
}

function loadPreferences() {
  // Load any saved preferences from localStorage
  const prefs = localStorage.getItem('pdfmerger-prefs');
  if (prefs) {
    try {
      const parsed = JSON.parse(prefs);
      // Apply preferences if needed
    } catch (e) {
      // Ignore invalid prefs
    }
  }
}

function savePreferences() {
  const prefs = {
    // Save any preferences
  };
  localStorage.setItem('pdfmerger-prefs', JSON.stringify(prefs));
}
