// Search Worker - Handles both simple and advanced search

let searchConfig = null;

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(term, wholeWord, caseSensitive) {
    let flags = caseSensitive ? '' : 'i';
    let pattern = escapeRegExp(term);
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    return new RegExp(pattern, flags);
}

function matchesAdvancedSearch(line, terms) {
    const includes = terms.filter(t => t.type === 'include');
    const excludes = terms.filter(t => t.type === 'exclude');

    for (const term of excludes) {
        const regex = buildRegex(term.term, term.wholeWord, term.caseSensitive);
        if (regex.test(line)) {
            return false;
        }
    }

    if (includes.length === 0) {
        return true;
    }

    for (const term of includes) {
        const regex = buildRegex(term.term, term.wholeWord, term.caseSensitive);
        if (!regex.test(line)) {
            return false;
        }
    }
    return true;
}

self.onmessage = function(event) {
    const { type, id, term, matchWholeWord, matchCase, terms, chunk, startLine } = event.data;

    if (type === 'init') {
        searchConfig = {
            type: 'simple',
            regex: buildRegex(term, matchWholeWord, matchCase)
        };
        return;
    }

    if (type === 'init-advanced') {
        searchConfig = {
            type: 'advanced',
            terms: terms
        };
        return;
    }

    if (type === 'chunk') {
        const lines = chunk.split(/\r?\n/);

        if (searchConfig.type === 'simple') {
            lines.forEach((line, idx) => {
                if (searchConfig.regex.test(line)) {
                    self.postMessage({ type: 'result', id, lineNum: startLine + idx });
                }
            });
        } else {
            lines.forEach((line, idx) => {
                if (matchesAdvancedSearch(line, searchConfig.terms)) {
                    self.postMessage({ type: 'result', id, lineNum: startLine + idx });
                }
            });
        }
        return;
    }

    if (type === 'done') {
        self.postMessage({ type: 'complete', id });
    }
};
