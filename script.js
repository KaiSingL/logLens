// LogLens - Handles large log files with streaming
// Supports files up to 10GB via chunked reading

// Configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const INITIAL_BATCH_SIZE = 50; // Initial results to display
const LAZY_LOAD_BATCH_SIZE = 30; // Additional results per scroll
const LAZY_LOAD_THRESHOLD = 200; // px from bottom to trigger load
const CIRCUMFERENCE = 62.83; // 2 * π * 10 for circular progress

// State
let currentFile = null;
let totalLines = 0;
let lineIndex = []; // Stores byte positions for line starts
let currentPage = 1;
let linesPerPage = 1000;
let searchTerm = '';
let searchResults = []; // Line numbers that match search
let currentMatchIndex = -1; // Index of currently highlighted match
let isSearching = false;
let searchAbortController = null;
let fileReadAbortController = null;
let loadedResultsCount = 0;
let isLazyLoading = false;
let searchScrollHandler = null;
let syntaxHighlightingEnabled = true; // One Dark syntax highlighting (default: on)
let matchWholeWord = false; // Match whole word only
let matchCase = false; // Match case sensitive
let drawerVisible = false; // Drawer visibility state

// Prism.js Web Worker for non-blocking highlighting
let prismWorker = null;
let workerJobId = 0;
const pendingJobs = new Map();

// Search Worker for fast chunk-based searching
let searchWorker = null;
let searchJobId = 0;
const pendingSearchJobs = new Map();

// DOM Elements
const uploadSection = document.getElementById('upload-section');
const viewerSection = document.getElementById('viewer-section');
const uploadInput = document.getElementById('upload');
const dropZone = document.getElementById('drop-zone');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const totalLinesEl = document.getElementById('total-lines');
const linesPerPageSelect = document.getElementById('lines-per-page');
const logContentInner = document.getElementById('log-content-inner');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const pageInput = document.getElementById('page-input');
const pageTotal = document.getElementById('page-total');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const searchProgressFill = document.getElementById('search-progress-fill');
const searchProgressEl = document.getElementById('search-progress-circular');
const wholeWordCheckbox = document.getElementById('option-whole-word');
const matchCaseCheckbox = document.getElementById('option-match-case');
const drawer = document.getElementById('search-sidebar');
const panelClose = document.getElementById('panel-close');
const toggleDrawerBtn = document.getElementById('toggle-side-panel');
const searchNav = document.getElementById('search-nav');
const matchCounterDrawer = document.getElementById('match-counter-drawer');
const btnPrevMatchDrawer = document.getElementById('btn-prev-match-drawer');
const btnNextMatchDrawer = document.getElementById('btn-next-match-drawer');
const matchNavContainer = document.getElementById('match-nav-container');
const matchCounterHeader = document.getElementById('match-counter-header');
const matchNoResultsHeader = document.getElementById('match-no-results-header');
const btnPrevMatchHeader = document.getElementById('btn-prev-match-header');
const btnNextMatchHeader = document.getElementById('btn-next-match-header');
const searchResultsItems = document.getElementById('search-results-items');
const searchResultsTitleText = document.getElementById('search-results-title-text');
const lazyLoadIndicator = document.getElementById('lazy-load-indicator');
const logContainer = document.getElementById('log-content');

// Download modal elements
const downloadModal = document.getElementById('download-modal');
const downloadClose = document.getElementById('download-close');
const downloadBackdrop = document.getElementById('download-modal');
const downloadStartLine = document.getElementById('download-start-line');
const downloadEndLine = document.getElementById('download-end-line');
const downloadPreview = document.getElementById('download-preview');
const downloadProgress = document.getElementById('download-progress');
const downloadProgressFill = document.getElementById('download-progress-fill');
const downloadProgressText = document.getElementById('download-progress-text');
const downloadSuccess = document.getElementById('download-success');
const downloadExecute = document.getElementById('download-execute');

let downloadAbortController = null;
let lastFocusedElement = null;

// Event Listeners
uploadInput.addEventListener('change', handleFileSelect);
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
linesPerPageSelect.addEventListener('change', handleLinesPerPageChange);
document.getElementById('btn-first').addEventListener('click', () => goToPage(1));
document.getElementById('btn-prev').addEventListener('click', () => goToPage(currentPage - 1));
document.getElementById('btn-next').addEventListener('click', () => goToPage(currentPage + 1));
document.getElementById('btn-last').addEventListener('click', () => goToPage(getTotalPages()));
pageInput.addEventListener('change', handlePageInput);
document.getElementById('download-page').addEventListener('click', openDownloadModal);
clearSearchBtn.addEventListener('click', clearSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') startSearch();
});

// Syntax highlighting toggle
document.getElementById('highlight-toggle').addEventListener('click', toggleSyntaxHighlighting);

// Drawer navigation
btnPrevMatchDrawer.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateMatch(-1);
});
btnNextMatchDrawer.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateMatch(1);
});

// Header navigation
btnPrevMatchHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateMatch(-1);
});
btnNextMatchHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateMatch(1);
});

// Drawer toggle
toggleDrawerBtn.addEventListener('click', toggleDrawer);
panelClose.addEventListener('click', closeDrawer);

// Download modal handlers
downloadClose.addEventListener('click', closeDownloadModal);
downloadBackdrop.addEventListener('click', (e) => {
    if (e.target === downloadBackdrop) {
        closeDownloadModal();
    }
});
downloadStartLine.addEventListener('input', updateDownloadPreview);
downloadEndLine.addEventListener('input', updateDownloadPreview);
downloadExecute.addEventListener('click', executeDownload);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !downloadModal.classList.contains('hidden')) {
        closeDownloadModal();
        return;
    }
    if (e.key === 'Escape' && searchTerm) {
        clearSearch();
        return;
    }
    if (e.key === 'b' || e.key === 'B') {
        if (document.activeElement === searchInput || document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            toggleDrawer();
        }
    }
    if (e.key === 'Enter' && e.shiftKey && searchResults.length > 0) {
        e.preventDefault();
        navigateMatch(-1);
    } else if (e.key === 'Enter' && searchResults.length > 0 && document.activeElement !== searchInput) {
        e.preventDefault();
        navigateMatch(1);
    }
});

// Search option toggles
wholeWordCheckbox.addEventListener('change', () => {
    matchWholeWord = wholeWordCheckbox.checked;
    updateSearchOptionStyles();
});
matchCaseCheckbox.addEventListener('change', () => {
    matchCase = matchCaseCheckbox.checked;
    updateSearchOptionStyles();
});

function updateSearchOptionStyles() {
    wholeWordCheckbox.parentElement.classList.toggle('checked', matchWholeWord);
    matchCaseCheckbox.parentElement.classList.toggle('checked', matchCase);
}

// File Handling
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) loadFile(file);
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
}

async function loadFile(file) {
    currentFile = file;
    totalLines = 0;
    lineIndex = [];
    currentPage = 1;
    searchTerm = '';
    searchResults = [];
    currentMatchIndex = -1;
    drawerVisible = false;
    
    searchInput.value = '';
    searchResultsItems.innerHTML = '';
    lazyLoadIndicator.classList.add('hidden');
    
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatFileSize(file.size);
    totalLinesEl.textContent = 'Counting...';
    
    uploadSection.classList.add('hidden');
    viewerSection.classList.remove('hidden');
    document.querySelector('.search-container').classList.remove('hidden');
    document.querySelector('.header-actions').classList.remove('hidden');
    
    showLoading('Building line index...');
    
    fileReadAbortController = new AbortController();
    try {
        await buildLineIndex(file);
        totalLinesEl.textContent = `${formatNumber(totalLines)} lines`;
        updatePagination();
        await loadPage(1);
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error loading file:', error);
            alert('Error loading file. Please try again.');
        }
    } finally {
        hideLoading();
    }
}

// Build line index by reading file in chunks
async function buildLineIndex(file) {
    const totalSize = file.size;
    let position = 0;
    let remainder = '';

    lineIndex = [0];
    totalLines = 1;

    while (position < totalSize) {
        if (fileReadAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const chunkSize = Math.min(CHUNK_SIZE, totalSize - position);
        const chunk = file.slice(position, position + chunkSize);
        const text = await chunk.text();

        const fullText = remainder + text;

        let i = remainder.length;
        let textProcessed = 0;

        while (i < fullText.length) {
            let char = fullText[i];

            if (char === '\n') {
                lineIndex.push(position + i + 1);
                totalLines++;
                i++;
            } else if (char === '\r') {
                if (i + 1 < fullText.length && fullText[i + 1] === '\n') {
                    lineIndex.push(position + i + 2);
                    totalLines++;
                    i += 2;
                } else {
                    lineIndex.push(position + i + 1);
                    totalLines++;
                    i++;
                }
            } else {
                i++;
            }
            textProcessed++;
        }

        remainder = fullText.slice(i);

        position += chunkSize;

        const progress = Math.round((position / totalSize) * 100);
        loadingText.textContent = `Building index... ${progress}% (${formatNumber(totalLines)} lines found)`;
    }

    if (remainder.length > 0) {
        lineIndex.push(position - remainder.length);
        totalLines++;
    } else if (totalSize > 0 && lineIndex.length === totalLines) {
        lineIndex.push(position);
    }
}

// Load a specific page
async function loadPage(pageNum) {
    if (pageNum < 1 || pageNum > getTotalPages()) return;
    
    currentPage = pageNum;
    pageInput.value = pageNum;
    
    showLoading(`Loading page ${pageNum}...`);
    
    try {
        const startLine = (pageNum - 1) * linesPerPage;
        const endLine = Math.min(startLine + linesPerPage, totalLines);
        
        const lines = await readLines(startLine, endLine);
        await renderLines(lines, startLine + 1);
    } finally {
        hideLoading();
        updatePageButtons();
    }
}

// Read specific lines from file (batched for performance)
async function readLines(startLine, endLine) {
    if (startLine >= endLine) return [];

    const startPos = lineIndex[startLine];
    const endPos = lineIndex[endLine] || currentFile.size;

    const slice = currentFile.slice(startPos, endPos);
    const text = await slice.text();

    const lines = [];
    let currentLine = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (char === '\n') {
            lines.push(currentLine);
            currentLine = '';
        } else if (char === '\r') {
            if (i + 1 < text.length && text[i + 1] === '\n') {
                lines.push(currentLine);
                currentLine = '';
                i++;
            } else {
                lines.push(currentLine);
                currentLine = '';
            }
        } else {
            currentLine += char;
        }
    }

    if (currentLine || lines.length < (endLine - startLine)) {
        lines.push(currentLine);
    }

    return lines;
}

// Render lines to DOM with Prism.js highlighting
async function renderLines(lines, startLineNum) {
    let highlightedLines;
    
    if (syntaxHighlightingEnabled) {
        loadingText.textContent = `Highlighting ${lines.length} lines...`;
        loadingOverlay.classList.add('visible');
        highlightedLines = await highlightLinesAsync(lines, startLineNum);
    } else {
        highlightedLines = lines.map((line, index) => ({
            lineNum: startLineNum + index,
            content: escapeHtml(line),
            logLevel: detectLogLevelFromLine(line)
        }));
    }

    let inheritedLogLevel = null;

    highlightedLines.forEach(lineData => {
        if (lineData.logLevel) {
            inheritedLogLevel = lineData.logLevel;
        } else if (inheritedLogLevel) {
            lineData.logLevel = inheritedLogLevel;
        } else {
            lineData.logLevel = 'other';
        }
    });
    
    const fragment = document.createDocumentFragment();
    
    highlightedLines.forEach(({ lineNum, content, logLevel }) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'log-line';
        lineEl.dataset.line = lineNum;
        
        if (logLevel) {
            lineEl.classList.add(`level-${logLevel}`);
        }
        

        
        const lineNumberEl = document.createElement('span');
        lineNumberEl.className = 'line-number';
        lineNumberEl.textContent = lineNum;
        
        const contentEl = document.createElement('span');
        contentEl.className = 'line-content';
        contentEl.innerHTML = content;
        
        if (searchTerm && !syntaxHighlightingEnabled) {
            const regex = new RegExp(escapeRegExp(searchTerm), 'gi');
            contentEl.innerHTML = content.replace(regex, match => 
                `<span class="search-highlight">${escapeHtml(match)}</span>`
            );
        }
        
        lineEl.appendChild(lineNumberEl);
        lineEl.appendChild(contentEl);
        fragment.appendChild(lineEl);
    });
    
    logContentInner.innerHTML = '';
    logContentInner.appendChild(fragment);
    
    if (syntaxHighlightingEnabled) {
        loadingOverlay.classList.remove('visible');
    }
}

/**
 * Detect log level from a line
 */
function detectLogLevelFromLine(line) {
    const upperLine = line.toUpperCase();
    if (/\b(ERROR|FAIL|FAILURE|FATAL|CRITICAL|ALERT|EMERGENCY|EE)\b/.test(upperLine) ||
        /\[\s*(ERROR|EROR|ERR|FATAL|FATL|FTL|E|F)\s*\]/.test(upperLine)) {
        return 'error';
    }
    if (/\b(WARNING|WARN|WW)\b/.test(upperLine) ||
        /\[\s*(WARNING|WARN|WRN|W)\s*\]/.test(upperLine)) {
        return 'warning';
    }
    if (/\b(INFO|INFORMATION|NOTICE|II)\b/.test(upperLine) ||
        /\[\s*(INFO|INF|I)\s*\]/.test(upperLine)) {
        return 'info';
    }
    if (/\b(DEBUG)\b/.test(upperLine) ||
        /\[\s*(DEBUG|DBG|D)\s*\]/.test(upperLine)) {
        return 'debug';
    }
    if (/\b(TRACE|VERBOSE)\b/.test(upperLine) ||
        /\[\s*(TRACE|VERBOSE|V)\s*\]/.test(upperLine)) {
        return 'trace';
    }
    return null;
}

/**
 * Initialize Prism Web Worker
 */
function initPrismWorker() {
    if (!prismWorker && window.Worker) {
        try {
            prismWorker = new Worker('prism-worker.js');
            
            prismWorker.onmessage = function(event) {
                const { id, success, highlightedLines, error } = event.data;
                const job = pendingJobs.get(id);
                
                if (job) {
                    pendingJobs.delete(id);
                    
                    if (success) {
                        job.resolve(highlightedLines);
                    } else {
                        job.reject(new Error(error));
                    }
                }
            };
            
            prismWorker.onerror = function(error) {
                console.error('Prism Worker error:', error);
                pendingJobs.forEach((job) => {
                    job.reject(error);
                });
                pendingJobs.clear();
            };
        } catch (e) {
            console.warn('Failed to initialize Prism Worker:', e);
            prismWorker = null;
        }
    }
}

/**
 * Terminate Prism Web Worker
 */
function terminatePrismWorker() {
    if (prismWorker) {
        prismWorker.terminate();
        prismWorker = null;
        pendingJobs.clear();
    }
}

/**
 * Initialize Search Worker for fast chunk-based searching
 */
function initSearchWorker() {
    if (!searchWorker && window.Worker) {
        try {
            searchWorker = new Worker('search-worker.js');

            searchWorker.onmessage = function(event) {
                const { type, id, lineNum } = event.data;
                const job = pendingSearchJobs.get(id);

                if (job) {
                    if (type === 'result') {
                        job.results.push(lineNum);
                    } else if (type === 'complete') {
                        job.resolve(job.results);
                        pendingSearchJobs.delete(id);
                    }
                }
            };

            searchWorker.onerror = function(error) {
                console.error('Search Worker error:', error);
                pendingSearchJobs.forEach((job) => {
                    job.reject(error);
                });
                pendingSearchJobs.clear();
            };
        } catch (e) {
            console.warn('Failed to initialize Search Worker:', e);
            searchWorker = null;
        }
    }
}

/**
 * Terminate Search Worker
 */
function terminateSearchWorker() {
    if (searchWorker) {
        searchWorker.terminate();
        searchWorker = null;
        pendingSearchJobs.clear();
    }
}

/**
 * Highlight lines using Prism.js via Web Worker
 */
async function highlightLinesAsync(lines, startLineNum) {
    if (!prismWorker) {
        return lines.map((line, index) => ({
            lineNum: startLineNum + index,
            content: highlightWithPrism(line),
            logLevel: detectLogLevelFromLine(line)
        }));
    }
    
    const id = ++workerJobId;
    const jobPromise = new Promise((resolve, reject) => {
        pendingJobs.set(id, { resolve, reject });
    });
    
    prismWorker.postMessage({
        id: id,
        lines: lines,
        startLineNum: startLineNum
    });
    
    return jobPromise;
}

/**
 * Highlight a single line with Prism.js
 */
function highlightWithPrism(line) {
    if (!line) return '';
    
    try {
        if (Prism.languages.log) {
            return Prism.highlight(line, Prism.languages.log, 'log');
        }
    } catch (e) {
        console.warn('Prism highlighting failed:', e);
    }
    
    return escapeHtml(line);
}

// Pagination Controls
async function goToPage(pageNum) {
    const totalPages = getTotalPages();
    if (pageNum < 1) pageNum = 1;
    if (pageNum > totalPages) pageNum = totalPages;
    await loadPage(pageNum);
    scrollToTop();
}

function handlePageInput(e) {
    const page = parseInt(e.target.value, 10);
    if (!isNaN(page)) {
        goToPage(page);
    }
}

async function handleLinesPerPageChange(e) {
    linesPerPage = parseInt(e.target.value, 10);
    currentPage = 1;
    updatePagination();
    await loadPage(1);
    scrollToTop();
}

function getTotalPages() {
    return Math.ceil(totalLines / linesPerPage);
}

function updatePagination() {
    const totalPages = getTotalPages();
    pageTotal.textContent = `/ ${formatNumber(totalPages)}`;
    pageInput.max = totalPages;
    updatePageButtons();
}

function updatePageButtons() {
    const totalPages = getTotalPages();
    const isFirstPage = currentPage === 1;
    const isLastPage = currentPage === totalPages;

    document.getElementById('btn-first').disabled = isFirstPage;
    document.getElementById('btn-prev').disabled = isFirstPage;
    document.getElementById('btn-next').disabled = isLastPage;
    document.getElementById('btn-last').disabled = isLastPage;
}

// Search Functionality
async function startSearch() {
    const term = searchInput.value.trim();
    if (!term || isSearching) return;

    if (searchAbortController) {
        searchAbortController.abort();
    }

    searchTerm = term;
    isSearching = true;
    searchResults = [];
    currentMatchIndex = -1;
    loadedResultsCount = 0;

    searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE;
    searchProgressEl.classList.add('active');
    clearSearchBtn.classList.remove('hidden');

    searchAbortController = new AbortController();

    try {
        if (!searchWorker) {
            initSearchWorker();
        }

        if (!searchWorker) {
            await searchOnMainThread(term);
        } else {
            await searchWithWorker(term);
        }

        if (totalLines === 0 || searchResults.length === 0) {
            updateSearchUIState(false);
            closeDrawer();
        } else {
            updateSearchUIState(true);

            currentMatchIndex = -1;
            await navigateMatch(1);
            await populateSearchResults();
            openDrawer();
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Search error:', error);
        }
    } finally {
        isSearching = false;
        searchProgressEl.classList.remove('active');
    }
}

async function searchWithWorker(term) {
    const jobId = ++searchJobId;
    const CHUNK_SIZE = 1024 * 1024;
    let totalChunks = Math.ceil(currentFile.size / CHUNK_SIZE);
    let processedChunks = 0;
    let lastLineIndex = 0;

    const jobPromise = new Promise((resolve, reject) => {
        pendingSearchJobs.set(jobId, { resolve, reject, results: [] });
    });

    searchWorker.postMessage({
        type: 'init',
        id: jobId,
        term,
        matchWholeWord,
        matchCase
    });

    for (let pos = 0; pos < currentFile.size; pos += CHUNK_SIZE) {
        if (searchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const chunkEnd = Math.min(pos + CHUNK_SIZE, currentFile.size);
        const chunk = await currentFile.slice(pos, chunkEnd).text();

        while (lastLineIndex < lineIndex.length && lineIndex[lastLineIndex] < pos) {
            lastLineIndex++;
        }
        const startLine = lastLineIndex;

        searchWorker.postMessage({
            type: 'chunk',
            id: jobId,
            chunk,
            startLine
        });

        processedChunks++;
        const progress = Math.round((processedChunks / totalChunks) * 100);
        searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);
    }

    searchWorker.postMessage({ type: 'done', id: jobId });

    searchResults = await jobPromise;
}

async function searchOnMainThread(term) {
    let regexFlags = matchCase ? '' : 'i';
    let pattern = escapeRegExp(term);
    if (matchWholeWord) pattern = `\\b${pattern}\\b`;
    const regex = new RegExp(pattern, regexFlags);

    const CHUNK_SIZE = 1024 * 1024;
    let totalChunks = Math.ceil(currentFile.size / CHUNK_SIZE);
    let processedChunks = 0;
    let lastLineIndex = 0;
    let hasTrailingNewline = true;

    for (let pos = 0; pos < currentFile.size; pos += CHUNK_SIZE) {
        if (searchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const chunkEnd = Math.min(pos + CHUNK_SIZE, currentFile.size);
        const chunk = await currentFile.slice(pos, chunkEnd).text();

        while (lastLineIndex < lineIndex.length && lineIndex[lastLineIndex] < pos) {
            lastLineIndex++;
        }
        const startLine = lastLineIndex;

        hasTrailingNewline = chunk.length > 0 && (chunk[chunk.length - 1] === '\n' || chunk[chunk.length - 1] === '\r');

        let lineStart = 0;
        let currentLine = startLine;
        for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === '\n') {
                const line = chunk.slice(lineStart, i);
                if (regex.test(line)) {
                    searchResults.push(currentLine);
                }
                currentLine++;
                lineStart = i + 1;
            }
        }
        
        if (lineStart < chunk.length && !hasTrailingNewline) {
            currentLine++;
        }

        processedChunks++;
        const progress = Math.round((processedChunks / totalChunks) * 100);
        searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);
    }
}

function clearSearch() {
    if (searchAbortController) {
        searchAbortController.abort();
    }

    searchTerm = '';
    searchResults = [];
    currentMatchIndex = -1;
    isSearching = false;
    loadedResultsCount = 0;

    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
    searchNav.classList.add('hidden');
    matchNavContainer.classList.add('hidden');
    matchCounterHeader.classList.remove('hidden');
    matchNoResultsHeader.classList.add('hidden');
    document.querySelector('#match-nav-container .match-nav-buttons').classList.remove('hidden');
    lazyLoadIndicator.classList.add('hidden');
    searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE;
    searchProgressEl.classList.remove('active');

    if (searchScrollHandler) {
        searchResultsItems.removeEventListener('scroll', searchScrollHandler);
        searchScrollHandler = null;
    }

    terminateSearchWorker();
    loadPage(currentPage);
}

// Search UI State Management
function updateSearchUIState(hasResults) {
    if (hasResults) {
        searchResultsTitleText.textContent = `Search Results (${formatNumber(searchResults.length)} matches)`;
        searchNav.classList.remove('hidden');
        matchNavContainer.classList.remove('hidden');
        matchCounterHeader.classList.remove('hidden');
        matchNoResultsHeader.classList.add('hidden');
        document.querySelector('#match-nav-container .match-nav-buttons').classList.remove('hidden');
    } else {
        searchNav.classList.add('hidden');
        matchNavContainer.classList.add('hidden');
        matchCounterHeader.classList.remove('hidden');
        matchNoResultsHeader.classList.add('hidden');
        document.querySelector('#match-nav-container .match-nav-buttons').classList.remove('hidden');
        
        if (searchResults.length === 0 && searchTerm) {
            searchResultsTitleText.textContent = 'No results found';
            matchNavContainer.classList.remove('hidden');
            matchCounterHeader.classList.add('hidden');
            matchNoResultsHeader.classList.remove('hidden');
            document.querySelector('#match-nav-container .match-nav-buttons').classList.add('hidden');
        }
    }
}

// Drawer Functions
function openDrawer() {
    drawerVisible = true;
    drawer.classList.add('visible');
    toggleDrawerBtn.classList.add('active');
}

function closeDrawer() {
    drawerVisible = false;
    drawer.classList.remove('visible');
    toggleDrawerBtn.classList.remove('active');
}

function toggleDrawer() {
    if (drawerVisible) {
        closeDrawer();
    } else {
        if (searchResults.length > 0) {
            updateSearchUIState(true);
        }
        openDrawer();
    }
}

// Navigate to next/previous match
async function navigateMatch(direction) {
    if (searchResults.length === 0 || totalLines === 0) return;
    
    currentMatchIndex += direction;
    
    if (currentMatchIndex < 0) {
        currentMatchIndex = searchResults.length - 1;
    } else if (currentMatchIndex >= searchResults.length) {
        currentMatchIndex = 0;
    }
    
    const targetLine = searchResults[currentMatchIndex] + 1;
    const targetPage = Math.floor(targetLine / linesPerPage) + 1;
    
    updateMatchCounter();
    
    if (targetPage !== currentPage) {
        await loadPage(targetPage);
    } else {
        const startLine = (currentPage - 1) * linesPerPage;
        const endLine = Math.min(startLine + linesPerPage, totalLines);
        const lines = await readLines(startLine, endLine);
        await renderLines(lines, startLine + 1);
    }
    
    scrollToMatch(targetLine);
    await updateActiveResultItem();
}

// Scroll to a specific match in the log
function scrollToMatch(lineNum) {
    const logLines = logContainer.querySelectorAll('.log-line');
    const relativeLineIndex = lineNum - 1 - ((currentPage - 1) * linesPerPage);
    
    if (logLines[relativeLineIndex]) {
        logLines[relativeLineIndex].classList.add('current-match');
        logLines[relativeLineIndex].scrollIntoView({ behavior: 'instant', block: 'center' });
    }
}

// Scroll to top of log content
function scrollToTop() {
    document.getElementById('log-top-anchor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Scroll to bottom of log content
function scrollToBottom() {
    document.getElementById('log-bottom-anchor').scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Update match counter display
function updateMatchCounter() {
    const text = searchResults.length === 0 ? 'No matches' : `${currentMatchIndex + 1} of ${searchResults.length}`;
    matchCounterDrawer.textContent = text;
    matchCounterHeader.textContent = text;
}

// Read a single line by line number
async function readLine(lineNum) {
    if (lineNum < 0 || lineNum >= totalLines) return '';

    const startPos = lineIndex[lineNum];
    const endPos = lineIndex[lineNum + 1] || currentFile.size;

    const slice = currentFile.slice(startPos, endPos);
    const text = await slice.text();

    return text.replace(/[\r\n]+$/, '');
}

// Populate search results drawer
async function populateSearchResults() {
    if (totalLines === 0 || searchResults.length === 0) {
        searchResultsItems.innerHTML = '<div class="empty-state"><p>No matches found</p></div>';
        return;
    }

    searchResultsItems.innerHTML = '';
    loadedResultsCount = 0;

    await loadSearchResultBatch(0, INITIAL_BATCH_SIZE);
    setupSearchResultsScrollListener();
}

// Load a batch of search results
async function loadSearchResultBatch(startIndex, count) {
    const endIndex = Math.min(startIndex + count, searchResults.length);

    for (let i = startIndex; i < endIndex; i++) {
        const lineNum = searchResults[i];
        const line = await readLine(lineNum);

        const resultItem = document.createElement('div');
        resultItem.className = 'search-result-item';
        resultItem.dataset.index = i;
        resultItem.dataset.line = lineNum;

        if (i === currentMatchIndex) {
            resultItem.classList.add('active');
        }

        const lineHeader = document.createElement('div');
        lineHeader.className = 'result-header';

        const lineNumEl = document.createElement('span');
        lineNumEl.className = 'result-line-num';
        lineNumEl.textContent = `Line ${lineNum + 1}`;

        lineHeader.appendChild(lineNumEl);
        resultItem.appendChild(lineHeader);

        const contentEl = document.createElement('div');
        contentEl.className = 'result-content';

        const MAX_PREVIEW_LENGTH = 300;
        const isLongLine = line.length > MAX_PREVIEW_LENGTH;

        if (isLongLine) {
            const truncated = line.substring(0, MAX_PREVIEW_LENGTH);
            const regex = new RegExp(escapeRegExp(searchTerm), matchCase ? '' : 'gi');
            const match = regex.exec(truncated);
            const matchStart = match ? match.index : 0;
            const matchEnd = match ? match.index + match[0].length : 0;

            let contextStart = Math.max(0, matchStart - 50);
            let contextEnd = Math.min(truncated.length, matchEnd + 100);
            let truncatedContent = line.substring(contextStart, contextEnd);

            if (contextStart > 0) truncatedContent = '...' + truncatedContent;
            if (contextEnd < line.length) truncatedContent = truncatedContent + '...';

            contentEl.innerHTML = `<span class="line-text">${escapeHtml(truncatedContent)}</span>`;
            resultItem.classList.add('truncated');
        } else {
            const regex = new RegExp(escapeRegExp(searchTerm), matchCase ? '' : 'gi');
            const highlighted = line.replace(regex, match => `<span class="search-highlight">${escapeHtml(match)}</span>`);
            contentEl.innerHTML = `<span class="line-text">${highlighted}</span>`;
        }

        resultItem.appendChild(contentEl);

        resultItem.addEventListener('click', () => {
            currentMatchIndex = i;
            navigateMatch(0);
            updateActiveResultItem();
        });

        searchResultsItems.appendChild(resultItem);
    }

    loadedResultsCount = endIndex;

    if (loadedResultsCount < searchResults.length) {
        lazyLoadIndicator.classList.remove('hidden');
    } else {
        lazyLoadIndicator.classList.add('hidden');
    }
}

// Set up scroll listener for lazy loading
function setupSearchResultsScrollListener() {
    if (searchScrollHandler) {
        searchResultsItems.removeEventListener('scroll', searchScrollHandler);
        searchScrollHandler = null;
    }

    searchScrollHandler = async () => {
        const scrollTop = searchResultsItems.scrollTop;
        const scrollHeight = searchResultsItems.scrollHeight;
        const clientHeight = searchResultsItems.clientHeight;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;

        if (distanceToBottom < LAZY_LOAD_THRESHOLD && !isLazyLoading && loadedResultsCount < searchResults.length) {
            isLazyLoading = true;
            lazyLoadIndicator.classList.remove('hidden');
            await loadSearchResultBatch(loadedResultsCount, LAZY_LOAD_BATCH_SIZE);
            isLazyLoading = false;
        }
    };

    searchResultsItems.addEventListener('scroll', searchScrollHandler);
}

// Update active result item styling
async function updateActiveResultItem() {
    let item = searchResultsItems.querySelector(`.search-result-item[data-index="${currentMatchIndex}"]`);

    while (!item && loadedResultsCount < searchResults.length) {
        await loadSearchResultBatch(loadedResultsCount, LAZY_LOAD_BATCH_SIZE);
        item = searchResultsItems.querySelector(`.search-result-item[data-index="${currentMatchIndex}"]`);
    }

    if (item) {
        const items = searchResultsItems.querySelectorAll('.search-result-item');
        items.forEach((el) => {
            if (parseInt(el.dataset.index) === currentMatchIndex) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'instant', block: 'nearest' });
            } else {
                el.classList.remove('active');
            }
        });
    }
}

// Download Modal
function openDownloadModal() {
    if (!currentFile) return;

    lastFocusedElement = document.activeElement;

    const startLine = (currentPage - 1) * linesPerPage + 1;
    const endLine = Math.min(startLine + linesPerPage - 1, totalLines);
    downloadStartLine.value = startLine;
    downloadEndLine.value = endLine;

    downloadProgress.classList.add('hidden');
    downloadSuccess.classList.add('hidden');
    downloadExecute.disabled = false;
    downloadExecute.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
    `;

    updateDownloadPreview();
    downloadModal.classList.remove('hidden');
    downloadModal.classList.add('visible');
    document.body.style.overflow = 'hidden';
    downloadStartLine.focus();
}

function closeDownloadModal() {
    if (downloadAbortController) {
        downloadAbortController.abort();
        downloadAbortController = null;
    }

    downloadModal.classList.add('hidden');
    downloadModal.classList.remove('visible');
    document.body.style.overflow = '';
    lastFocusedElement?.focus();
}

function updateDownloadPreview() {
    const start = parseInt(downloadStartLine.value) || 1;
    const end = parseInt(downloadEndLine.value) || 1;
    const validStart = Math.max(1, Math.min(start, totalLines));
    const validEnd = Math.max(validStart, Math.min(end, totalLines));

    if (start !== validStart) downloadStartLine.value = validStart;
    if (end !== validEnd) downloadEndLine.value = validEnd;

    const count = Math.max(0, validEnd - validStart + 1);

    const countEl = document.getElementById('preview-count');
    const rangeEl = document.getElementById('preview-range');
    const maxEl = document.getElementById('preview-max');

    if (countEl) countEl.textContent = `${formatNumber(count)} lines selected`;
    if (rangeEl) rangeEl.textContent = `Lines ${formatNumber(validStart)} - ${formatNumber(validEnd)}`;
    if (maxEl) maxEl.textContent = `· Max: ${formatNumber(totalLines)}`;
}

async function executeDownload() {
    if (!currentFile) return;

    const start = parseInt(downloadStartLine.value);
    const end = parseInt(downloadEndLine.value);

    if (start < 1 || end < start || end > totalLines) {
        downloadPreview.textContent = 'Invalid line range';
        return;
    }

    downloadAbortController = new AbortController();
    downloadProgress.classList.remove('hidden');
    downloadSuccess.classList.add('hidden');
    downloadSuccess.classList.remove('visible');
    downloadExecute.disabled = true;
    downloadExecute.classList.add('btn-loading');

    try {
        const lines = await readLinesWithProgress(start - 1, end);
        const content = lines.join('\n');

        const ext = currentFile.name.split('.').pop() || 'log';
        const filename = `${currentFile.name.replace(/\.[^/.]+$/, '')}_lines_${start}-${end}.${ext}`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        downloadProgress.classList.add('hidden');
        downloadSuccess.classList.remove('hidden');
        downloadSuccess.classList.add('visible');
        downloadProgressFill.style.width = '0%';
    } catch (error) {
        if (error.name !== 'AbortError') {
            downloadPreview.textContent = `Error: ${error.message}`;
        }
    }

    downloadExecute.disabled = false;
    downloadExecute.classList.remove('btn-loading');
    downloadAbortController = null;
}

async function readLinesWithProgress(startLine, endLine) {
    const totalToRead = endLine - startLine;
    const CHUNK_SIZE = 10000;
    let lines = [];
    let lastProgress = 0;

    for (let i = startLine; i < endLine; i += CHUNK_SIZE) {
        if (downloadAbortController?.signal.aborted) {
            throw new Error('AbortError');
        }

        const chunkEnd = Math.min(i + CHUNK_SIZE, endLine);
        const chunkLines = await readLines(i, chunkEnd);
        lines.push(...chunkLines);

        const progress = Math.round(((chunkEnd - startLine) / totalToRead) * 100);
        if (progress >= lastProgress + 5) {
            lastProgress = progress;
            downloadProgressFill.style.width = `${progress}%`;
            downloadProgressText.textContent = `${progress}%`;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    return lines;
}

// UI Helpers
function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.add('visible');
}

function hideLoading() {
    loadingOverlay.classList.remove('visible');
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num) {
    return num.toLocaleString();
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toggle syntax highlighting
function toggleSyntaxHighlighting() {
    syntaxHighlightingEnabled = !syntaxHighlightingEnabled;
    
    const toggleBtn = document.getElementById('highlight-toggle');
    const toggleSpan = toggleBtn.querySelector('span');
    
    if (syntaxHighlightingEnabled) {
        toggleBtn.classList.add('active');
        if (toggleSpan) toggleSpan.textContent = 'Highlight';
        initPrismWorker();
    } else {
        toggleBtn.classList.remove('active');
        if (toggleSpan) toggleSpan.textContent = 'Plain';
    }
    
    loadPage(currentPage);
}

// Initialize workers and setup
document.addEventListener('DOMContentLoaded', () => {
    if (syntaxHighlightingEnabled) {
        initPrismWorker();
    }
    initSearchWorker();
    updateSearchOptionStyles();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    terminatePrismWorker();
    terminateSearchWorker();
});
