import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createPayment, getPaymentStatus, PaymentError } from './lib/payment.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }

export function createHandler({ key = process.env.BLACKCAT_API_KEY, origin = process.env.APP_ORIGIN, fetchImpl = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Método não permitido.' }); }
        const expectedHost = origin ? new URL(origin).host : req.headers.host;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && new URL(req.headers.origin).host !== expectedHost)) throw new PaymentError('Origem não permitida.', 403);
        if (!String(req.headers['content-type']).startsWith('application/json')) throw new PaymentError('Formato de requisição inválido.', 415);
        if (Number(req.headers['content-length']) > 8192) throw new PaymentError('Requisição muito grande.', 413);
        const chunks = [];
        let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 8192) throw new PaymentError('Requisição muito grande.', 413); chunks.push(chunk); }
        const body = Buffer.concat(chunks).toString('utf8');
        let input;
        try { input = JSON.parse(body); } catch { throw new PaymentError('Dados inválidos.'); }
        if (url.pathname === '/api/pix') return send(res, 200, await createPayment(input, key, fetchImpl));
        if (url.pathname === '/api/status') return send(res, 200, await getPaymentStatus(input?.token, key, fetchImpl));
        return send(res, 404, { error: 'Rota não encontrada.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
      const path = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(resolve(publicDir) + sep)) return send(res, 404, { error: 'Página não encontrada.' });
      let data;
      try { data = await readFile(path); } catch { return send(res, 404, { error: 'Página não encontrada.' }); }
      res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      send(res, error instanceof PaymentError ? error.status : 500, { error: error instanceof PaymentError ? error.message : 'Não foi possível concluir a solicitação.' });
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer(createHandler()).listen(port, '0.0.0.0', () => console.log(`Checkout: http://localhost:${port}`));
}
