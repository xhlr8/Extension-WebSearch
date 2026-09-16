import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([
    ['/', ['./preview.html', 'text/html; charset=utf-8']],
    ['/preview-browser.js', ['./preview-browser.js', 'application/javascript']],
    ['/tavily-panel.js', ['../tavily-panel.js', 'application/javascript']],
    ['/tavily-panel.css', ['../tavily-panel.css', 'text/css']],
]);
http.createServer(async (req, res) => {
    try {
        if (!files.has(req.url)) { res.writeHead(404); res.end(); return; }
        const [file, type] = files.get(req.url);
        res.setHeader('Content-Type', type);
        res.end(await readFile(new URL(file, import.meta.url)));
    } catch { res.writeHead(500); res.end('Fixture failure'); }
}).listen(4187, '127.0.0.1', () => console.log('Mock preview http://127.0.0.1:4187'));
