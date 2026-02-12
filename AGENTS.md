# AGENTS.md - LogLens Development Guide

## Project Overview

**LogLens** is a browser-based log file viewer that handles files up to 10GB via chunked reading and streaming. Uses Web Workers for non-blocking search and syntax highlighting.

- **Type**: Single-page web application (vanilla JavaScript)
- **License**: AGPL v3
- **Tech Stack**: Vanilla ES6+, CSS Custom Properties, HTML5, Web Workers
- **Dependencies**: Prism.js v1.29.0, JetBrains Mono v2.304 (both vendored)
- **Offline**: Fully offline capable - all dependencies vendored

## Build & Development Commands

No build step required. Open `index.html` directly in browser:

```bash
# macOS
open index.html

# Linux
xdg-open index.html

# Windows
start index.html
```

**Linting**: None configured (vanilla JS project)

**Testing**: No automated tests. Manual test checklist:
- File upload (drag-drop and file picker)
- Pagination navigation (prev/next, page input)
- Search functionality (simple and advanced)
- Syntax highlighting toggle
- Download modal
- Responsive sidebar resize

## Code Style Guidelines

### JavaScript (script.js, prism-worker.js, search-worker.js)

**Naming**:
- Variables/functions: `camelCase` (e.g., `currentFile`, `loadPage`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `CHUNK_SIZE`)
- DOM elements: Suffix with `El` (e.g., `fileNameEl`, `logContainer`)
- Private/worker state: Prefix with `_` (e.g., `_state`)

**Formatting**:
- Indent: 4 spaces
- Semicolons: Always use
- Braces: Same-line for functions and conditionals
- Line length: No hard limit

```javascript
// Correct
function loadPage(pageNum) {
    if (pageNum < 1) return;
    // ...
}

// Incorrect
function loadPage(pageNum)
{
    if (pageNum < 1)
        return;
}
```

**Imports**: None (vanilla JS, no modules). Workers use `importScripts()`:

```javascript
importScripts(
    'vendor/prism/prism.min.js',
    'vendor/prism/components/prism-log.min.js'
);
```

**Error Handling**:
- Use `try/catch` with `finally` for async operations
- Check `error.name === 'AbortError'` to ignore cancelled operations
- Log with `console.error()` before user notification
- Use `alert()` sparingly for critical failures only

**Async Patterns**:
- Use `async/await` with explicit error handling
- Use `AbortController` for cancellable operations
- Workers use job-based messaging with promise resolution

**Comments**:
- Use JSDoc for public functions
- Inline comments for complex logic only

### CSS (style.css)

**Naming**: BEM-lite with hyphens (e.g., `.log-line`, `.search-drawer`)

**Variables**: Define all colors, spacing, transitions in `:root`

```css
:root {
    --color-accent: #FE3B15;
    --spacing-md: 12px;
    --radius-lg: 12px;
    --transition-fast: 150ms ease;
}
```

**Ordering**:
1. Variables
2. Base reset
3. Components
4. Utility classes

### HTML (index.html)

- Semantic HTML5 elements
- ARIA labels for interactive elements
- Skip link for accessibility

## Architecture

### File Processing Pipeline

```
File Input → buildLineIndex() → lineIndex[] (byte positions)
            → loadPage(pageNum) → readLines() → renderLines()
            → highlightLinesAsync() → prism-worker.js
```

### Search Implementation

- Primary: `search-worker.js` for non-blocking search
- Fallback: Main thread for browsers without Worker support
- Job-based communication with promise resolution

### State Management

- Module-level variables (no framework)
- DOM elements cached at top of file
- AbortControllers for operation cancellation

## Performance

- **Chunk size**: 1MB for file reading
- **Lazy loading**: 30 results per scroll in search drawer
- **Workers**: Prism highlighting in background thread
- **Memory**: Line index stores byte positions (not full content)
- **UI**: `scrollIntoView({ behavior: 'instant' })` for performance

## Constraints

- **Desktop only**: No mobile/responsive support
- **No build system**: All changes reflected immediately
- **AGPL licensed**: Changes must be open-sourced
- **Single CSS file**: All styles in `style.css`

## File Structure

```
logViewer/
├── index.html          # Main application
├── script.js           # Core application logic
├── style.css          # All styling
├── prism-one-dark.css # Syntax highlighting theme
├── prism-worker.js    # Prism.js Web Worker
├── search-worker.js   # Search Web Worker
├── LICENSE            # AGPL v3
├── AGENTS.md         # This file
├── assets/icons/      # App icons (16x16 to 512x512)
└── vendor/            # Third-party dependencies
    ├── fonts/jetbrains-mono/
    └── prism/
```

## Git Workflow

Provide commit message for uncommitted changes after coding.

**Format**:
```
<type>(<scope>): <subject>

<body>
```

**Types**:
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `refactor` - Code restructuring
- `chore` - Maintenance

**Example**:
```
feat(search): add advanced search with AND/OR operators

- Add support for include/exclude terms
- Add OR operator for alternative matching
- Update UI with term management interface
```
