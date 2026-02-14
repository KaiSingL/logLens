// LogLens - Handles large log files with streaming
// Supports files up to 10GB via chunked reading

// Configuration
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const INITIAL_BATCH_SIZE = 200; // Initial results to display (sliding window)
const SLIDING_WINDOW_SIZE = 300; // Maximum items to keep in DOM
const VISIBILITY_ROOT_MARGIN = '150px';
const VISIBILITY_THRESHOLD = 0;
const CIRCUMFERENCE = 62.83; // 2 * π * 10 for circular progress

// State
let currentFile = null;
let totalLines = 0;
let lineIndex = []; // Stores byte positions for line starts
let currentPage = 1;
let linesPerPage = 1000;
let _linesPerPageOpen = false;
let searchTerm = '';
let searchResults = []; // Line numbers that match search
let currentMatchIndex = -1; // Index of currently highlighted match
let isSearching = false;
let searchAbortController = null;
let fileReadAbortController = null;
let loadedResultsCount = 0;
let firstLoadedIndex = 0; // Sliding window: index of first visible item
let visibilityObserver = null;
let itemsMutationObserver = null;
const visibleIndices = new Set();
let syntaxHighlightingEnabled = true; // One Dark syntax highlighting (default: on)
let matchWholeWord = false; // Match whole word only
let matchCase = false; // Match case sensitive
let drawerVisible = false; // Drawer visibility state
let currentSearchId = 0;
let isLoadingBatch = false;

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
const linesPerPageDropdown = document.getElementById('lines-per-page-dropdown');
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
const matchTotalHeader = document.getElementById('match-total-header');
const matchTotalDrawer = document.getElementById('match-total-drawer');
const searchResultsList = document.getElementById('search-results-list');
const searchResultsItems = document.getElementById('search-results-items');
const searchResultsTitleText = document.getElementById('search-results-title-text');
const lazyLoadIndicator = document.getElementById('lazy-load-indicator');
const logContainer = document.getElementById('log-content');

const RESIZE_MIN_WIDTH = 380;
let sidebarWidth = 380;
let isResizing = false;
let resizeHandle = document.getElementById('sidebar-resize-handle');

// Advanced search state
let advancedSearchTerms = [];
let termIdCounter = 0;
let advancedSearchAbortController = null;

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

// Advanced search modal elements
const advancedSearchDropdown = document.getElementById('advanced-search-dropdown');
const advancedSearchBtn = document.getElementById('advanced-search-btn');
const advancedSearchClose = document.getElementById('advanced-search-close');
const advancedSearchTermsContainer = document.getElementById('advanced-search-terms');
const addIncludeTermBtn = document.getElementById('add-include-term');
const addExcludeTermBtn = document.getElementById('add-exclude-term');
const termRowTemplate = document.getElementById('term-row-template');
const searchInputWrapper = document.getElementById('search-input-wrapper');

let downloadAbortController = null;
let lastFocusedElement = null;

if (resizeHandle) {
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebarWidth;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const container = document.querySelector('.container');
        const containerRect = container.getBoundingClientRect();

        const deltaX = startX - e.clientX;
        const maxWidth = containerRect.width * 0.6;
        const newWidth = Math.max(RESIZE_MIN_WIDTH, Math.min(startWidth + deltaX, maxWidth));

        sidebarWidth = Math.round(newWidth);
        drawer.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Event Listeners
uploadInput.addEventListener('change', handleFileSelect);
dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);
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

// Match counter input handlers
matchCounterDrawer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        goToMatch(matchCounterDrawer.value);
        matchCounterDrawer.blur();
    }
});

matchCounterHeader.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        goToMatch(matchCounterHeader.value);
        matchCounterHeader.blur();
    }
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

// Advanced search dropdown handlers
advancedSearchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAdvancedSearchDropdown();
});

advancedSearchClose.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAdvancedSearchDropdown();
});

addIncludeTermBtn.addEventListener('click', () => addIncludeTerm());
addExcludeTermBtn.addEventListener('click', () => addExcludeTerm());

// Custom dropdown events
linesPerPageDropdown.querySelector('.custom-dropdown-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLinesPerPageDropdown();
});

linesPerPageDropdown.querySelectorAll('.custom-dropdown-option').forEach(option => {
    option.addEventListener('click', () => {
        selectLinesPerPage(option.dataset.value, option);
    });
});

linesPerPageDropdown.querySelector('.custom-dropdown-menu').addEventListener('keydown', (e) => {
    const options = Array.from(linesPerPageDropdown.querySelectorAll('.custom-dropdown-option'));
    const currentIndex = options.findIndex(opt => opt === document.activeElement);

    if (e.key === 'Escape') {
        closeLinesPerPageDropdown();
        linesPerPageDropdown.querySelector('.custom-dropdown-trigger').focus();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % options.length;
        options[nextIndex].focus();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        options[prevIndex].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (currentIndex >= 0) {
            selectLinesPerPage(options[currentIndex].dataset.value, options[currentIndex]);
        }
    }
});

document.addEventListener('click', (e) => {
    if (!linesPerPageDropdown.contains(e.target)) {
        closeLinesPerPageDropdown();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !downloadModal.classList.contains('hidden')) {
        closeDownloadModal();
        return;
    }
    if (e.key === 'Enter' && e.shiftKey && searchResults.length > 0) {
        e.preventDefault();
        navigateMatch(-1);
    } else if (e.key === 'Enter' && searchResults.length > 0 && 
               document.activeElement !== searchInput &&
               document.activeElement !== matchCounterDrawer &&
               document.activeElement !== matchCounterHeader) {
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
    visibleIndices.clear();
    
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

function toggleLinesPerPageDropdown() {
    _linesPerPageOpen = !_linesPerPageOpen;
    const trigger = linesPerPageDropdown.querySelector('.custom-dropdown-trigger');
    const menu = linesPerPageDropdown.querySelector('.custom-dropdown-menu');

    if (_linesPerPageOpen) {
        linesPerPageDropdown.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        menu.focus();
    } else {
        linesPerPageDropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
}

function selectLinesPerPage(value, optionEl) {
    linesPerPage = parseInt(value, 10);
    currentPage = 1;
    updatePagination();
    loadPage(1);
    scrollToTop();

    const valueSpan = linesPerPageDropdown.querySelector('.custom-dropdown-value');
    valueSpan.textContent = value;

    linesPerPageDropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    optionEl.classList.add('selected');

    toggleLinesPerPageDropdown();
}

function closeLinesPerPageDropdown() {
    if (_linesPerPageOpen) {
        _linesPerPageOpen = false;
        linesPerPageDropdown.classList.remove('open');
        linesPerPageDropdown.querySelector('.custom-dropdown-trigger').setAttribute('aria-expanded', 'false');
    }
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
function hasAdvancedTerms() {
    updateAdvancedSearchState();
    return advancedSearchTerms.length > 0;
}

async function startSearch() {
    const term = searchInput.value.trim();
    if (!term || isSearching) return;

    if (hasAdvancedTerms()) {
        await performAdvancedSearch();
        return;
    }

    if (searchAbortController) {
        searchAbortController.abort();
    }

    searchTerm = term;
    isSearching = true;
    searchResults = [];
    currentMatchIndex = -1;
    loadedResultsCount = 0;
    isLoadingBatch = false;
    visibleIndices.clear();

    searchResultsItems.innerHTML = '';
    clearVisibilityObservers();
    lazyLoadIndicator.classList.add('hidden');

    searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE;
    searchProgressEl.classList.add('active');
    clearSearchBtn.classList.remove('hidden');

    searchAbortController = new AbortController();
    const thisSearchId = ++currentSearchId;

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
            await populateSearchResults(thisSearchId);
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

async function performAdvancedSearch() {
    if (isSearching) return;

    if (advancedSearchAbortController) {
        advancedSearchAbortController.abort();
    }

    searchTerm = searchInput.value.trim();
    isSearching = true;
    searchResults = [];
    currentMatchIndex = -1;
    loadedResultsCount = 0;
    isLoadingBatch = false;
    visibleIndices.clear();

    searchResultsItems.innerHTML = '';
    clearVisibilityObservers();
    lazyLoadIndicator.classList.add('hidden');

    searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE;
    searchProgressEl.classList.add('active');
    clearSearchBtn.classList.remove('hidden');

    advancedSearchAbortController = new AbortController();
    const thisSearchId = ++currentSearchId;

    const mainTerm = searchInput.value.trim();
    if (mainTerm) {
        const mainTermExists = advancedSearchTerms.some(t => t.term === mainTerm);
        if (!mainTermExists) {
            advancedSearchTerms.unshift({
                type: 'include',
                term: mainTerm,
                wholeWord: matchWholeWord,
                caseSensitive: matchCase
            });
        }
    }

    try {
        if (!searchWorker) {
            initSearchWorker();
        }

        if (!searchWorker) {
            await advancedSearchOnMainThread();
        } else {
            await advancedSearchWithWorker();
        }

        if (totalLines === 0 || searchResults.length === 0) {
            updateSearchUIState(false);
            closeDrawer();
        } else {
            updateSearchUIState(true);

            currentMatchIndex = -1;
            await navigateMatch(1);
            await populateSearchResults(thisSearchId);
            openDrawer();
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Advanced search error:', error);
        }
    } finally {
        isSearching = false;
        searchProgressEl.classList.remove('active');
    }
}

async function searchWithWorker(term) {
    const jobId = ++searchJobId;
    const LINES_PER_BATCH = 5000;
    let totalBatches = Math.ceil(totalLines / LINES_PER_BATCH);
    let processedBatches = 0;

    const jobPromise = new Promise((resolve, reject) => {
        pendingSearchJobs.set(jobId, { resolve, reject, results: [] });
    });

    if (advancedSearchTerms.length > 0) {
        searchWorker.postMessage({
            type: 'init-advanced',
            id: jobId,
            terms: advancedSearchTerms
        });
    } else {
        searchWorker.postMessage({
            type: 'init',
            id: jobId,
            term,
            matchWholeWord,
            matchCase
        });
    }

    for (let batchStart = 0; batchStart < totalLines; batchStart += LINES_PER_BATCH) {
        if (searchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const batchEnd = Math.min(batchStart + LINES_PER_BATCH, totalLines);
        const startPos = lineIndex[batchStart];
        const endPos = lineIndex[batchEnd] || currentFile.size;
        const chunk = await currentFile.slice(startPos, endPos).text();

        searchWorker.postMessage({
            type: 'chunk',
            id: jobId,
            chunk,
            startLine: batchStart
        });

        processedBatches++;
        const progress = Math.round((processedBatches / totalBatches) * 100);
        searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);
    }

    searchWorker.postMessage({ type: 'done', id: jobId });

    searchResults = await jobPromise;
}

async function advancedSearchWithWorker() {
    const jobId = ++searchJobId;
    const LINES_PER_BATCH = 5000;
    let totalBatches = Math.ceil(totalLines / LINES_PER_BATCH);
    let processedBatches = 0;

    const jobPromise = new Promise((resolve, reject) => {
        pendingSearchJobs.set(jobId, { resolve, reject, results: [] });
    });

    searchWorker.postMessage({
        type: 'init-advanced',
        id: jobId,
        terms: advancedSearchTerms
    });

    for (let batchStart = 0; batchStart < totalLines; batchStart += LINES_PER_BATCH) {
        if (advancedSearchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const batchEnd = Math.min(batchStart + LINES_PER_BATCH, totalLines);
        const startPos = lineIndex[batchStart];
        const endPos = lineIndex[batchEnd] || currentFile.size;
        const chunk = await currentFile.slice(startPos, endPos).text();

        searchWorker.postMessage({
            type: 'chunk',
            id: jobId,
            chunk,
            startLine: batchStart
        });

        processedBatches++;
        const progress = Math.round((processedBatches / totalBatches) * 100);
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

    const LINES_PER_BATCH = 5000;
    let totalBatches = Math.ceil(totalLines / LINES_PER_BATCH);
    let processedBatches = 0;

    for (let batchStart = 0; batchStart < totalLines; batchStart += LINES_PER_BATCH) {
        if (searchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const batchEnd = Math.min(batchStart + LINES_PER_BATCH, totalLines);
        const startPos = lineIndex[batchStart];
        const endPos = lineIndex[batchEnd] || currentFile.size;
        const chunk = await currentFile.slice(startPos, endPos).text();

        const lines = chunk.split(/\r?\n/);
        lines.forEach((line, idx) => {
            if (regex.test(line)) {
                searchResults.push(batchStart + idx);
            }
        });

        processedBatches++;
        const progress = Math.round((processedBatches / totalBatches) * 100);
        searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);
    }
}

async function advancedSearchOnMainThread() {
    const includes = advancedSearchTerms.filter(t => t.type === 'include');
    const excludes = advancedSearchTerms.filter(t => t.type === 'exclude');

    const LINES_PER_BATCH = 5000;
    let totalBatches = Math.ceil(totalLines / LINES_PER_BATCH);
    let processedBatches = 0;

    for (let batchStart = 0; batchStart < totalLines; batchStart += LINES_PER_BATCH) {
        if (advancedSearchAbortController.signal.aborted) {
            throw new Error('AbortError');
        }

        const batchEnd = Math.min(batchStart + LINES_PER_BATCH, totalLines);
        const startPos = lineIndex[batchStart];
        const endPos = lineIndex[batchEnd] || currentFile.size;
        const chunk = await currentFile.slice(startPos, endPos).text();

        const lines = chunk.split(/\r?\n/);
        lines.forEach((line, idx) => {
            let excluded = false;

            for (const term of excludes) {
                let flags = term.caseSensitive ? '' : 'i';
                let pattern = escapeRegExp(term.term);
                if (term.wholeWord) pattern = `\\b${pattern}\\b`;
                const regex = new RegExp(pattern, flags);
                if (regex.test(line)) {
                    excluded = true;
                    break;
                }
            }

            if (excluded) return;

            if (includes.length === 0) {
                searchResults.push(batchStart + idx);
                return;
            }

            if (includes.every(term => {
                let flags = term.caseSensitive ? '' : 'i';
                let pattern = escapeRegExp(term.term);
                if (term.wholeWord) pattern = `\\b${pattern}\\b`;
                return new RegExp(pattern, flags).test(line);
            })) {
                searchResults.push(batchStart + idx);
            }
        });

        processedBatches++;
        const progress = Math.round((processedBatches / totalBatches) * 100);
        searchProgressFill.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress / 100);
    }
}

function clearSearch() {
    searchTerm = '';
    searchInput.value = '';
    clearSearchBtn.classList.add('hidden');
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
            searchResultsItems.innerHTML = '';
            matchNavContainer.classList.remove('hidden');
            matchCounterHeader.classList.add('hidden');
            document.querySelector('#match-nav-container .match-nav-input-group').classList.add('hidden');
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
    resizeHandle.classList.add('visible');
}

function closeDrawer() {
    drawerVisible = false;
    drawer.classList.remove('visible');
    toggleDrawerBtn.classList.remove('active');
    resizeHandle.classList.remove('visible');
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

// Jump to a specific match by number
async function goToMatch(matchNumber) {
    if (searchResults.length === 0 || totalLines === 0) return;
    
    const index = parseInt(matchNumber, 10) - 1;
    
    if (isNaN(index) || index < 0 || index >= searchResults.length) {
        updateMatchCounter();
        return;
    }
    
    currentMatchIndex = index;
    
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
    if (searchResults.length === 0) {
        matchCounterDrawer.value = '';
        matchCounterHeader.value = '';
        matchTotalDrawer.textContent = '0';
        matchTotalHeader.textContent = '0';
    } else {
        matchCounterDrawer.value = currentMatchIndex + 1;
        matchCounterHeader.value = currentMatchIndex + 1;
        matchTotalDrawer.textContent = searchResults.length;
        matchTotalHeader.textContent = searchResults.length;
    }
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
async function populateSearchResults(searchId) {
    if (totalLines === 0 || searchResults.length === 0) {
        searchResultsItems.innerHTML = '<div class="empty-state"><p>No matches found</p></div>';
        return;
    }

    if (searchId !== currentSearchId) return;

    searchResultsItems.innerHTML = '';
    loadedResultsCount = 0;
    firstLoadedIndex = 0;
    isLoadingBatch = false;
    visibleIndices.clear();

    await loadSearchResultBatch(searchId, 0, INITIAL_BATCH_SIZE);
    initVisibilityObserver();
    setupItemObserver();
}

// Load a batch of search results
async function loadSearchResultBatch(searchId, startIndex, count) {
    if (searchId !== currentSearchId) return;

    const endIndex = Math.min(startIndex + count, searchResults.length);

    // Build a set of indices already in DOM to skip duplicates
    const existingIndices = new Set();
    searchResultsItems.querySelectorAll('.search-result-item').forEach(el => {
        existingIndices.add(parseInt(el.dataset.index));
    });

    for (let i = startIndex; i < endIndex; i++) {
        // Skip items already in the DOM
        if (existingIndices.has(i)) continue;

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

        // Insert in sorted order by data-index
        let inserted = false;
        const children = searchResultsItems.children;
        for (let c = 0; c < children.length; c++) {
            const childIndex = parseInt(children[c].dataset.index);
            if (childIndex > i) {
                searchResultsItems.insertBefore(resultItem, children[c]);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            searchResultsItems.appendChild(resultItem);
        }

        // Observe the newly added item immediately
        if (visibilityObserver) {
            visibilityObserver.observe(resultItem);
        }
    }

    loadedResultsCount = Math.max(loadedResultsCount, endIndex);
    firstLoadedIndex = Math.min(firstLoadedIndex, startIndex);

    lazyLoadIndicator.classList.toggle('hidden', loadedResultsCount >= searchResults.length);
}

// Update active result item styling
async function updateActiveResultItem() {
    try {
        let item = searchResultsItems.querySelector(`.search-result-item[data-index="${currentMatchIndex}"]`);

        // Always check if item exists in DOM - it may have been trimmed by sliding window
        if (!item) {
            const loadStart = Math.max(0, currentMatchIndex - Math.floor(SLIDING_WINDOW_SIZE / 2));
            await loadSearchResultBatch(currentSearchId, loadStart, SLIDING_WINDOW_SIZE);
            item = searchResultsItems.querySelector(`.search-result-item[data-index="${currentMatchIndex}"]`);
        }

        if (!item) return;

        const items = searchResultsItems.querySelectorAll('.search-result-item');
        items.forEach(el => {
            if (parseInt(el.dataset.index) === currentMatchIndex) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });

        item.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    } catch (error) {
        console.debug('updateActiveResultItem failed:', error);
    }
}

function getVisibleRange() {
    if (visibleIndices.size === 0) {
        return { min: 0, max: 0, count: 0 };
    }
    const indices = Array.from(visibleIndices);
    return {
        min: Math.min(...indices),
        max: Math.max(...indices),
        count: visibleIndices.size
    };
}

function updateLoadedResultsState() {
    const items = searchResultsItems.querySelectorAll('.search-result-item');
    if (items.length === 0) {
        loadedResultsCount = 0;
        firstLoadedIndex = 0;
        return;
    }
    const indices = Array.from(items).map(el => parseInt(el.dataset.index));
    firstLoadedIndex = Math.min(...indices);
    loadedResultsCount = Math.max(...indices) + 1;
    lazyLoadIndicator.classList.toggle('hidden', loadedResultsCount >= searchResults.length);
}

function trimResultsOutsideVisibleRange(visibleRange) {
    const buffer = 100;
    const keepStart = Math.max(0, visibleRange.min - buffer);
    const keepEnd = Math.min(searchResults.length, visibleRange.max + buffer + buffer);
    const items = searchResultsItems.querySelectorAll('.search-result-item');
    let needsUpdate = false;
    items.forEach(item => {
        const index = parseInt(item.dataset.index);
        if (index < keepStart || index >= keepEnd) {
            visibilityObserver?.unobserve(item);
            item.remove();
            visibleIndices.delete(index);
            needsUpdate = true;
        }
    });
    if (needsUpdate) updateLoadedResultsState();
}

async function handleVisibilityChange() {
    if (isLoadingBatch) return;
    try {
        const visibleRange = getVisibleRange();
        if (visibleRange.count === 0) return;

        const loadBuffer = 50;

        // Load more items below the visible range (scroll down)
        if (visibleRange.max >= loadedResultsCount - loadBuffer && loadedResultsCount < searchResults.length) {
            isLoadingBatch = true;
            lazyLoadIndicator.classList.remove('hidden');
            try {
                await loadSearchResultBatch(currentSearchId, loadedResultsCount, SLIDING_WINDOW_SIZE);
            } finally {
                lazyLoadIndicator.classList.add('hidden');
                isLoadingBatch = false;
            }
        }

        // Load more items above the visible range (scroll up)
        if (visibleRange.min <= firstLoadedIndex + loadBuffer && firstLoadedIndex > 0) {
            isLoadingBatch = true;
            try {
                const loadStart = Math.max(0, firstLoadedIndex - SLIDING_WINDOW_SIZE);
                const loadCount = firstLoadedIndex - loadStart;
                await loadSearchResultBatch(currentSearchId, loadStart, loadCount);
            } finally {
                isLoadingBatch = false;
            }
        }

        // Trim items far outside the visible range to keep DOM bounded
        trimResultsOutsideVisibleRange(visibleRange);
    } catch (error) {
        console.debug('handleVisibilityChange failed:', error);
    }
}

function initVisibilityObserver() {
    if (visibilityObserver) visibilityObserver.disconnect();
    visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const index = parseInt(entry.target.dataset.index);
            if (isNaN(index)) return;
            entry.isIntersecting ? visibleIndices.add(index) : visibleIndices.delete(index);
        });
        handleVisibilityChange();
    }, { root: searchResultsList, rootMargin: VISIBILITY_ROOT_MARGIN, threshold: VISIBILITY_THRESHOLD });
    searchResultsItems.querySelectorAll('.search-result-item').forEach(item => visibilityObserver.observe(item));
}

function setupItemObserver() {
    if (itemsMutationObserver) itemsMutationObserver.disconnect();
    itemsMutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1 && node.classList.contains('search-result-item')) {
                    visibilityObserver?.observe(node);
                }
            });
            mutation.removedNodes.forEach(node => {
                if (node.nodeType === 1 && node.classList.contains('search-result-item')) {
                    const index = parseInt(node.dataset.index);
                    if (!isNaN(index)) visibleIndices.delete(index);
                    visibilityObserver?.unobserve(node);
                }
            });
        });
    });
    itemsMutationObserver.observe(searchResultsItems, { childList: true, subtree: false });
}

function clearVisibilityObservers() {
    visibilityObserver?.disconnect();
    visibilityObserver = null;
    itemsMutationObserver?.disconnect();
    itemsMutationObserver = null;
    visibleIndices.clear();
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

// Advanced Search Dropdown
function openAdvancedSearchDropdown() {
    advancedSearchDropdown.classList.remove('hidden');
    advancedSearchDropdown.classList.add('visible');
    advancedSearchBtn.classList.add('active');
    
    setTimeout(() => {
        const firstInput = advancedSearchTermsContainer.querySelector('.term-input');
        if (firstInput) {
            firstInput.focus();
        } else {
            addIncludeTermBtn.focus();
        }
    }, 50);
}

function closeAdvancedSearchDropdown() {
    advancedSearchDropdown.classList.add('hidden');
    advancedSearchDropdown.classList.remove('visible');
    if (advancedSearchTerms.length === 0) {
        advancedSearchBtn.classList.remove('active');
    }
}

function setupAdvancedModeHandlers() {
    searchInputWrapper.addEventListener('click', openAdvancedSearchDropdown);
    advancedSearchBtn.classList.add('active');
    advancedSearchBtn.disabled = !searchInput.value.trim();
    
    searchInput.addEventListener('input', updateAdvancedButtonState);
}

function clearAdvancedModeHandlers() {
    searchInputWrapper.removeEventListener('click', openAdvancedSearchDropdown);
    advancedSearchBtn.classList.remove('active');
    advancedSearchBtn.disabled = false;
    searchInput.removeEventListener('input', updateAdvancedButtonState);
    closeAdvancedSearchDropdown();
}

function updateAdvancedButtonState() {
    const hasMainTerm = searchInput.value.trim().length > 0;
    const hasDropdownTerms = advancedSearchTerms.length > 0;
    const isDropdownOpen = advancedSearchDropdown.classList.contains('visible');
    advancedSearchBtn.disabled = false;
    if (hasDropdownTerms || isDropdownOpen) {
        advancedSearchBtn.classList.add('active');
    } else if (hasMainTerm) {
        advancedSearchBtn.classList.remove('active');
    }
}

document.addEventListener('click', (e) => {
    if (advancedSearchDropdown.classList.contains('visible')) {
        const inSearchBar = e.target.closest('.search-bar-wrapper');
        const inDropdown = e.target.closest('#advanced-search-dropdown');
        if (!inSearchBar && !inDropdown) {
            closeAdvancedSearchDropdown();
        }
    }
});

function createTermRow(config) {
    const row = termRowTemplate.content.cloneNode(true);
    const termRow = row.querySelector('.term-row');
    const includeCheckbox = row.querySelector('.term-include-checkbox');
    const termInput = row.querySelector('.term-input');
    const wholeWordCheckbox = row.querySelector('.term-whole-word');
    const caseSensitiveCheckbox = row.querySelector('.term-case-sensitive');
    const operatorToggle = row.querySelector('.term-operator-toggle');
    const deleteBtn = row.querySelector('.term-delete');
    const toggle = row.querySelector('.term-toggle');

    const id = ++termIdCounter;

    if (config) {
        includeCheckbox.checked = config.type === 'include';
        termInput.value = config.term || '';
        wholeWordCheckbox.checked = config.wholeWord || false;
        caseSensitiveCheckbox.checked = config.caseSensitive || false;
    } else {
        includeCheckbox.checked = true;
    }

    if (includeCheckbox.checked) {
        toggle.classList.add('include');
        toggle.classList.remove('exclude');
    } else {
        toggle.classList.add('exclude');
        toggle.classList.remove('include');
    }

    if (wholeWordCheckbox.checked) {
        wholeWordCheckbox.parentElement.classList.add('checked');
    }
    if (caseSensitiveCheckbox.checked) {
        caseSensitiveCheckbox.parentElement.classList.add('checked');
    }

    includeCheckbox.addEventListener('change', () => {
        if (includeCheckbox.checked) {
            toggle.classList.add('include');
            toggle.classList.remove('exclude');
        } else {
            toggle.classList.add('exclude');
            toggle.classList.remove('include');
        }
        updateAdvancedSearchState();
    });

    termInput.addEventListener('input', () => {
        updateAdvancedSearchState();
    });

    termInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rows = advancedSearchTermsContainer.querySelectorAll('.term-row');
            let foundCurrent = false;
            for (const r of rows) {
                if (foundCurrent) {
                    const input = r.querySelector('.term-input');
                    if (input) {
                        input.focus();
                        return;
                    }
                }
                if (r === termRow) foundCurrent = true;
            }
            executeAdvancedSearch();
        }
    });

    wholeWordCheckbox.addEventListener('change', () => {
        wholeWordCheckbox.parentElement.classList.toggle('checked', wholeWordCheckbox.checked);
        updateAdvancedSearchState();
    });

    caseSensitiveCheckbox.addEventListener('change', () => {
        caseSensitiveCheckbox.parentElement.classList.toggle('checked', caseSensitiveCheckbox.checked);
        updateAdvancedSearchState();
    });

    operatorToggle.addEventListener('click', () => {
        // Operator is now fixed to AND, no toggle functionality
    });

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        termInput.blur();
        termRow.remove();
        updateAdvancedSearchState();
        updateEmptyState();
    });

    return { id, element: termRow };
}

function updateAdvancedSearchState() {
    const rows = advancedSearchTermsContainer.querySelectorAll('.term-row');
    advancedSearchTerms = [];

    rows.forEach((row, index) => {
        const includeCheckbox = row.querySelector('.term-include-checkbox');
        const termInput = row.querySelector('.term-input');
        const wholeWordCheckbox = row.querySelector('.term-whole-word');
        const caseSensitiveCheckbox = row.querySelector('.term-case-sensitive');
        const operatorToggle = row.querySelector('.term-operator-toggle');

        const term = termInput.value.trim();
        if (term) {
            advancedSearchTerms.push({
                type: includeCheckbox.checked ? 'include' : 'exclude',
                term: term,
                wholeWord: wholeWordCheckbox.checked,
                caseSensitive: caseSensitiveCheckbox.checked
            });
        }
    });
}

function updateEmptyState() {
    const rows = advancedSearchTermsContainer.querySelectorAll('.term-row');
    const emptyState = advancedSearchTermsContainer.querySelector('.advanced-search-terms-empty');

    if (rows.length === 0) {
        if (!emptyState) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'advanced-search-terms-empty';
            emptyEl.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <p>Add search terms to build your query</p>
            `;
            advancedSearchTermsContainer.appendChild(emptyEl);
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

function addIncludeTerm(config) {
    const mainTerm = searchInput.value.trim();
    if (!mainTerm) {
        searchInput.classList.add('error');
        setTimeout(() => searchInput.classList.remove('error'), 300);
        return;
    }

    updateEmptyState();
    const { id, element } = createTermRow(config);
    advancedSearchTermsContainer.appendChild(element);

    const input = element.querySelector('.term-input');
    input.focus();

    updateAdvancedSearchState();
}

function addExcludeTerm(config) {
    const mainTerm = searchInput.value.trim();
    if (!mainTerm) {
        searchInput.classList.add('error');
        setTimeout(() => searchInput.classList.remove('error'), 300);
        return;
    }

    updateEmptyState();
    const termConfig = config || { type: 'exclude' };
    const { id, element } = createTermRow(termConfig);
    advancedSearchTermsContainer.appendChild(element);

    const input = element.querySelector('.term-input');
    input.focus();

    updateAdvancedSearchState();
}

function clearAdvancedSearchModal() {
    advancedSearchTermsContainer.innerHTML = '';
    advancedSearchTerms = [];
    updateEmptyState();
}

function executeAdvancedSearch() {
    updateAdvancedSearchState();

    if (advancedSearchTerms.length === 0) {
        closeAdvancedSearchDropdown();
        return;
    }

    setupAdvancedModeHandlers();

    closeAdvancedSearchDropdown();
    startSearch();
}

function resetToSimpleSearch() {
    advancedSearchTerms = [];
    clearAdvancedModeHandlers();
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
    if (typeof APP_VERSION !== 'undefined') {
        const versionEl = document.getElementById('app-version');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
    }
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
