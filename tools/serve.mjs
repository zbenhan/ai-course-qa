/**
 * 本地预览用静态服务器（零依赖），方便在自己电脑上先看页面效果。
 *
 * 用法：
 *   npm run serve
 * 然后浏览器打开：
 *   http://localhost:5173/?api=http://localhost:8787
 * （?api=... 会把页面接口地址临时指向本地后端，便于联调）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', 'docs');
const port = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    let filePath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (filePath === '/') filePath = '/index.html';
    const target = path.join(root, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found: ' + filePath);
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(port, () => {
    console.log(`本地预览: http://localhost:${port}/?api=http://localhost:8787`);
  });
