# AGENTS.md - LogLens Development Guide

This file provides guidelines for AI agents working on the LogLens codebase.

## Project Overview

**LogLens** is a browser-based log file viewer that handles files up to 10GB via chunked reading and streaming. It uses Web Workers for non-blocking search and syntax highlighting.

- **Type**: Single-page web application (vanilla JavaScript)
- **License**: AGPL v3
- **Tech Stack**: Vanilla ES6+, CSS Custom Properties, HTML5, Web Workers
- **Dependencies**: Prism.js (v1.29.0, vendored), JetBrains Mono (v2.304, vendored)
- **Offline Support**: Fully offline capable - all dependencies are vendored

## Build & Development Commands

This project requires no build step. Simply open `index.html` in a browser.

```bash
# No build commands required
# Open index.html directly in browser
start index.html   # Windows
open index.html    # macOS
xdg-open index.html  # Linux
```

**Testing**: No automated tests exist. Manual testing required for:
- File upload (drag-drop and file picker)
- Pagination navigation
- Search functionality (worker and main thread)
- Syntax highlighting toggle
- Download modal

## Code Style Guidelines

### JavaScript (script.js, prism-worker.js, search-worker.js)

**Naming Conventions**:
- Variables/functions: `camelCase` (e.g., `currentFile`, `loadPage`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `CHUNK_SIZE`, `INITIAL_BATCH_SIZE`)
- DOM elements: Prefix with element type (e.g., `fileNameEl`, `logContainer`)
- Private/worker state: Prefix with `_` (e.g., `_state`)

**Formatting**:
- Indent: 4 spaces
- Line length: No hard limit, use discretion
- Semicolons: Always use
- Braces: Same-line for functions, newline for blocks

```javascript
// Correct
function loadPage(pageNum) {
    if (pageNum < 1) return;
    // ...
}

// Incorrect (braces on new line)
function loadPage(pageNum)
{
    // ...
}
```

**Error Handling**:
- Use `try/catch` with `finally` for async operations
- Check `error.name === 'AbortError'` to ignore cancelled operations
- Log errors with `console.error()` before user notification
- Use `alert()` sparingly for critical failures only

**Async Patterns**:
- Use `async/await` with explicit error handling
- Use `AbortController` for cancellable operations
- Workers return promises for job-based communication

**Comments**:
- Use JSDoc for public/helper functions
- Inline comments for complex logic
- Header comments for file purpose

### CSS (style.css)

**Naming**: BEM-lite with hyphenated classes (e.g., `.log-line`, `.search-drawer`)

**Variables**: Define all colors, spacing, and transitions in `:root`

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
5. Responsive (removed - desktop only)

### HTML (index.html)

**Structure**:
- Semantic HTML5 elements (`<header>`, `<main>`, `<footer>`)
- ARIA labels for interactive elements
- Skip link for accessibility

## Architecture Notes

### File Processing Pipeline

```
File Input → buildLineIndex() → lineIndex[] (byte positions)
            → loadPage(pageNum) → readLines() → renderLines()
            → highlightLinesAsync() → Web Worker (prism-worker.js)
```

### Search Implementation

- Primary: Web Worker (`search-worker.js`) for non-blocking search
- Fallback: Main thread for browsers without Worker support
- Job-based communication with promise resolution

### State Management

- Module-level variables for state (no framework)
- DOM elements cached at top of file
- AbortControllers for operation cancellation

## Performance Considerations

- **Chunk size**: 1MB for file reading
- **Lazy loading**: 30 results per scroll in search drawer
- **Workers**: Prism highlighting in background thread
- **Memory**: Line index stored as byte positions (not full content)
- **UI**: `scrollIntoView({ behavior: 'instant' })` for performance

## Adding New Features

1. **New UI Component**: Add CSS to `style.css`, HTML to `index.html`
2. **New Worker**: Follow pattern in `search-worker.js` with job-based messaging
3. **File Processing**: Add to `buildLineIndex()` or `readLines()` pipeline
4. **Search Features**: Extend `search-worker.js` message types

## File Structure

```
logViewer/
├── index.html          # Main application
├── script.js           # Core application logic
├── style.css          # All styling (merged, no brutalist)
├── prism-one-dark.css # Syntax highlighting theme
├── prism-worker.js    # Prism.js Web Worker
├── search-worker.js   # Search Web Worker
├── LICENSE            # AGPL v3
├── AGENTS.md         # This file
├── assets/
│   └── icons/         # App icons (16x16 to 512x512)
└── vendor/            # Third-party dependencies (offline capable)
    ├── fonts/
    │   └── jetbrains-mono/   # JetBrains Mono v2.304
    │       ├── JetBrainsMono-Regular.woff2
    │       ├── JetBrainsMono-Bold.woff2
    │       └── fonts.css
    └── prism/                # Prism.js v1.29.0
        ├── prism.min.js
        └── components/
            └── prism-log.min.js
```

## Important Constraints

- **No mobile support**: Responsive breakpoints removed, desktop-only
- **No build system**: All changes reflected immediately
- **AGPL licensed**: Changes must be open-sourced
- **Single CSS file**: All styles in `style.css`, no external CSS beyond Prism

## Git Workflow

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `refactor` - Code restructuring
- `migrate` - Repository/dependency migration
- `chore` - Maintenance tasks

### Example Commit Message

```
migrate(index.html): update head for private repo deployment

- Remove Open Graph and Twitter image references (no public hosting)
- Remove og:url property (private repo)
- Update icon paths from relative ../../ to root-relative /
- Update logo link to root path /
- Update copyright year to 2026
```
