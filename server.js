const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, 'web');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.cue': 'text/plain; charset=UTF-8',
  '.toml': 'text/plain; charset=UTF-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  // Required security headers for WebAssembly SharedArrayBuffer and performance
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/log') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      fs.appendFileSync(path.join(__dirname, 'browser.log'), body + '\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/dump_frame')) {
    const parsed = new URL(req.url, 'http://localhost:3000');
    const name = parsed.searchParams.get('name') || 'frame';
    const frame = parsed.searchParams.get('frame') || '0';
    const w = parseInt(parsed.searchParams.get('w') || '0', 10);
    const h = parseInt(parsed.searchParams.get('h') || '0', 10);
    const format = parsed.searchParams.get('format') || 'RGBA';
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const rawPath = path.join(__dirname, `dump_${name}_frame${frame}.raw`);
      const pngPath = path.join(__dirname, `dump_${name}_frame${frame}.png`);
      fs.writeFileSync(rawPath, buf);
      try {
        require('child_process').execSync(`python3 -c "from PIL import Image; img = Image.frombytes('${format}', (${w}, ${h}), open('${rawPath}', 'rb').read()); img.save('${pngPath}')"`);
        console.log(`[DUMP] Saved ${pngPath} (${w}x${h}, format=${format}, ${buf.length} bytes)`);
      } catch (err) {
        console.error('[DUMP] PNG conversion error:', err);
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }

  let reqUrl = decodeURIComponent(req.url.split('?')[0]);
  if (reqUrl === '/') reqUrl = '/index.html';

  let filePath = path.join(ROOT_DIR, reqUrl);

  // Prevent directory traversal attacks
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${reqUrl}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Support HTTP Range headers for large file streaming (.bin / .wasm)
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Tekken 3 Web Server running at:`);
  console.log(` http://localhost:${PORT}`);
  console.log(` COOP/COEP headers enabled`);
  console.log(`===============================================`);
});
