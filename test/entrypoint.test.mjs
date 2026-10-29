import test from 'node:test';
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import server from '../server.mjs';

test('Vercel entrypoint exports a usable HTTP server without binding a port on import', async t => {
  assert.ok(server instanceof Server);
  assert.equal(server.listening, false);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /GERAR CÓDIGO QR/);
  for (const path of ['/styles.css', '/app.js', '/assets/banner.png', '/assets/logo.png', '/assets/br.svg']) {
    const asset = await fetch(base + path);
    assert.equal(asset.status, 200, path);
    assert.ok((await asset.arrayBuffer()).byteLength > 0, path);
  }
  const api = await fetch(base + '/api/pix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(api.status, 400);
  assert.match((await api.json()).error, /nome completo/);
});
