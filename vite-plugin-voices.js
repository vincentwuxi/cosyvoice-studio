/**
 * Vite Plugin: Voice File System API
 * Provides REST endpoints for saving/loading voice profiles to disk.
 * 
 * Routes:
 *   POST   /voices-api/save     - Save voice audio + metadata
 *   GET    /voices-api/list     - List all saved voices
 *   GET    /voices-api/audio/:id - Get voice audio file
 *   DELETE /voices-api/delete/:id - Delete a voice profile
 *   POST   /voices-api/sync     - Sync from browser to filesystem
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOICES_DIR = path.join(__dirname, 'public', 'voices');
const META_FILE = path.join(VOICES_DIR, 'voices.json');

function ensureDir() {
  if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
  }
}

function readMeta() {
  ensureDir();
  if (!fs.existsSync(META_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeMeta(list) {
  ensureDir();
  fs.writeFileSync(META_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export default function voicesPlugin() {
  return {
    name: 'voices-api',
    configureServer(server) {
      // Collect multipart body as raw buffer
      const collectBody = (req) => new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
      });

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');

        // ── POST /voices-api/save ──
        if (req.method === 'POST' && url.pathname === '/voices-api/save') {
          try {
            const contentType = req.headers['content-type'] || '';
            if (!contentType.includes('multipart/form-data')) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Expected multipart/form-data' }));
            }

            const boundary = contentType.split('boundary=')[1];
            const body = await collectBody(req);
            const parts = parseMultipart(body, boundary);

            const metaPart = parts.find(p => p.name === 'meta');
            const audioPart = parts.find(p => p.name === 'audio');

            if (!metaPart || !audioPart) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ error: 'Missing meta or audio' }));
            }

            const meta = JSON.parse(metaPart.data.toString('utf-8'));
            const audioFileName = `${meta.id}.wav`;
            
            ensureDir();
            fs.writeFileSync(path.join(VOICES_DIR, audioFileName), audioPart.data);

            const list = readMeta();
            const existIdx = list.findIndex(v => v.id === meta.id);
            if (existIdx >= 0) {
              list[existIdx] = { ...list[existIdx], ...meta };
            } else {
              list.unshift(meta);
            }
            writeMeta(list);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, id: meta.id }));
          } catch (err) {
            console.error('[voices-api] save error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
          }
        }

        // ── GET /voices-api/list ──
        if (req.method === 'GET' && url.pathname === '/voices-api/list') {
          const list = readMeta();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(list));
        }

        // ── GET /voices-api/audio/:id ──
        if (req.method === 'GET' && url.pathname.startsWith('/voices-api/audio/')) {
          const id = url.pathname.split('/voices-api/audio/')[1];
          const filePath = path.join(VOICES_DIR, `${id}.wav`);
          if (!fs.existsSync(filePath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Not found' }));
          }
          const stat = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': stat.size,
          });
          return fs.createReadStream(filePath).pipe(res);
        }

        // ── DELETE /voices-api/delete/:id ──
        if (req.method === 'DELETE' && url.pathname.startsWith('/voices-api/delete/')) {
          const id = url.pathname.split('/voices-api/delete/')[1];
          const filePath = path.join(VOICES_DIR, `${id}.wav`);
          try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch {}
          const list = readMeta().filter(v => v.id !== id);
          writeMeta(list);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true }));
        }

        next();
      });
    }
  };
}

/**
 * Minimal multipart/form-data parser
 * Handles binary data correctly for audio files
 */
function parseMultipart(body, boundary) {
  const parts = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBuf = Buffer.from(`--${boundary}--`);
  
  let start = indexOf(body, boundaryBuf, 0);
  if (start === -1) return parts;
  
  while (true) {
    start += boundaryBuf.length;
    // skip \r\n after boundary
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
    
    const nextBoundary = indexOf(body, boundaryBuf, start);
    if (nextBoundary === -1) break;
    
    // Find end of headers (double CRLF)
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;
    
    const headerStr = body.slice(start, headerEnd).toString('utf-8');
    const dataStart = headerEnd + 4;
    // data ends 2 bytes before next boundary (\r\n)
    let dataEnd = nextBoundary - 2;
    if (dataEnd < dataStart) dataEnd = dataStart;
    
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        data: body.slice(dataStart, dataEnd),
      });
    }
    
    // Check if next boundary is the ending
    if (indexOf(body, endBuf, nextBoundary) === nextBoundary) break;
    start = nextBoundary;
    start -= boundaryBuf.length; // will be added back at top of loop
  }
  
  return parts;
}

function indexOf(buf, search, fromIndex) {
  for (let i = fromIndex; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
