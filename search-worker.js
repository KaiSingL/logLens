// Search Worker - Performs chunk-based search in background

let regex = null;

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

self.onmessage = function(event) {
    const { type, id, term, matchWholeWord, matchCase, chunk, startLine } = event.data;

    if (type === 'init') {
        let flags = matchCase ? '' : 'i';
        let pattern = escapeRegExp(term);
        if (matchWholeWord) pattern = `\\b${pattern}\\b`;
        regex = new RegExp(pattern, flags);
        return;
    }

    if (type === 'chunk') {
        const { chunk, startLine } = event.data;
        const lines = chunk.split(/\r?\n/);

        lines.forEach((line, idx) => {
            if (regex.test(line)) {
                self.postMessage({ type: 'result', id, lineNum: startLine + idx });
            }
        });
        return;
    }

    if (type === 'done') {
        self.postMessage({ type: 'complete', id });
    }
};
