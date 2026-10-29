import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../server.mjs';
import { createPayment, customerFrom, getPaymentStatus, paymentToken, readToken, validDocument } from '../lib/payment.mjs';

const customer = { name: 'Pessoa de Teste', email: 'teste@example.com', phone: '(11) 99999-9999', document: '529.982.247-25' };
const key = 'unit-test-key-not-a-real-credential';
const success = (data, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
const sale = { transactionId: 'TXN-TEST', amount: 19770, paymentData: { copyPaste: '000201-test-only', qrCodeBase64: 'data:image/png;base64,aGVsbG8=', expiresAt: '2026-12-01T10:00:00Z' } };

test('validates CPF/CNPJ checksum and rejects incomplete/repeated documents', () => {
  assert.equal(validDocument('52998224725'), true);
  assert.equal(validDocument('11222333000181'), true);
  for (const n of ['11111111111', '52998224724', '11222333000180', '123']) assert.equal(validDocument(n), false);
  assert.equal(customerFrom({ ...customer, phone: '+55 11 99999-9999' }).phone, '11999999999');
  assert.throws(() => customerFrom({ ...customer, email: 'invalid' }));
});

test('fixes price on server, normalizes customer and maps documented Black Cat response', async () => {
  const result = await createPayment({ ...customer, amount: 1, items: [] }, key, async (url, options) => {
    assert.equal(url, 'https://api.blackcatoficial.com/api/sales/create-sale');
    assert.equal(options.headers['X-API-Key'], key);
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.equal(body.amount, 19770);
    assert.equal(body.items[0].unitPrice, 19770);
    assert.equal(body.items[0].quantity, 1);
    assert.equal(body.items[0].tangible, false);
    assert.equal(body.paymentMethod, 'pix');
    assert.deepEqual(body.customer.document, { type: 'cpf', number: '52998224725' });
    return success(sale, 201);
  });
  assert.equal(result.amount, 19770);
  assert.equal(result.code, sale.paymentData.copyPaste);
  assert.equal(readToken(result.token, key), sale.transactionId);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('status tokens cannot be tampered with, expired, or signed with another key', () => {
  const token = paymentToken('TXN-TEST', key, 1000);
  assert.equal(readToken(token, key, 2000), 'TXN-TEST');
  assert.throws(() => readToken(token + 'x', key, 2000));
  assert.throws(() => readToken(token, 'wrong-key', 2000));
  assert.throws(() => readToken(token, key, 1000 + 48 * 60 * 60 * 1000));
});

test('queries payment status directly without saving a transaction', async () => {
  const token = paymentToken('TXN-TEST', key);
  const result = await getPaymentStatus(token, key, async (url, options) => {
    assert.equal(url, 'https://api.blackcatoficial.com/api/sales/TXN-TEST/status');
    assert.equal(options.method, 'GET');
    return success({ transactionId: 'TXN-TEST', amount: 19770, status: 'PAID' });
  });
  assert.deepEqual(result, { status: 'PAID' });
  await assert.rejects(getPaymentStatus(token, key, async () => success({ transactionId: 'OTHER', amount: 19770, status: 'PAID' })), { status: 502 });
});

test('handles absent credentials, gateway failure, malformed data, and mismatched amount', async () => {
  await assert.rejects(createPayment(customer, '', () => assert.fail('must not call gateway')), { status: 503 });
  await assert.rejects(createPayment(customer, key, async () => { throw new Error('private error'); }), { status: 504 });
  await assert.rejects(createPayment(customer, key, async () => new Response('not JSON')), { status: 502 });
  await assert.rejects(createPayment(customer, key, async () => success({ ...sale, amount: 1 })), { status: 502 });
  await assert.rejects(createPayment(customer, key, async () => new Response(JSON.stringify({ success: false, error: key }), { status: 401 })), error => error.status === 502 && !error.message.includes(key));
});

test('HTTP: serves checkout, validates JSON/origin/size, hides secrets, creates and checks Pix', async t => {
  const server = createServer(createHandler({ key, fetchImpl: async url => url.endsWith('/status') ? success({ transactionId: 'TXN-TEST', amount: 19770, status: 'PAID' }) : success(sale) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/api/pix')).status, 405);
  assert.equal((await post('/api/pix', customer, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post('/api/pix', 'bad-json')).status, 400);
  assert.equal((await post('/api/pix', { ...customer, document: '11111111111' })).status, 400);
  assert.equal((await post('/api/pix', 'x'.repeat(9000))).status, 413);
  const response = await post('/api/pix', customer);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const pix = await response.json();
  assert.equal(pix.code, sale.paymentData.copyPaste);
  const status = await post('/api/status', { token: pix.token });
  assert.deepEqual(await status.json(), { status: 'PAID' });
});
