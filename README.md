# LogLens

[![Version](https://img.shields.io/badge/version-1.3.2-blue.svg)]()
[![License](https://img.shields.io/badge/license-AGPL%20v3-green.svg)](LICENSE)

Browser-based log file viewer that handles files up to 10GB. No server required.

**Live Demo**: https://kaisingl.github.io/logLens/

## Features

- **Large file support** - Handles files up to 10GB via chunked streaming
- **Non-blocking UI** - Web Workers for search and syntax highlighting
- **Advanced search** - Simple search + multi-term include/exclude with AND/OR operators
- **Syntax highlighting** - Prism.js with One Dark theme (toggleable)
- **Pagination** - Configurable lines per page (100, 500, 1000, 5000, 10000)
- **Download segments** - Export specific line ranges (max 50,000 lines)
- **Fully offline** - All dependencies vendored, works without internet
- **Drag & drop** - Easy file upload

## Quick Start

1. Open `index.html` in your browser
2. Drag & drop a log file or click to select
3. Navigate pages, search, and highlight

## Usage

### Navigation
- Page through logs with pagination controls
- Jump to specific page by typing page number
- Configure lines per page via dropdown

### Search
- **Simple search**: Type in search bar, press Enter
- **Match options**: Whole word, case sensitive
- **Advanced search**: Add multiple include/exclude terms with AND/OR operators

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Next search match |
| Shift+Enter | Previous search match |
| Escape | Close modal |

## Technology

- Vanilla ES6+ JavaScript (no framework)
- Web Workers for non-blocking operations
- Chunked file reading (1MB chunks)
- Prism.js for syntax highlighting
- JetBrains Mono font

## Browser Support

Modern browsers with File API and Web Worker support (Chrome, Firefox, Safari, Edge).

## License

[GNU Affero General Public License v3.0](LICENSE)
