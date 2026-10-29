import { createHmac, timingSafeEqual } from 'node:crypto';

export const AMOUNT = 19770;
export const PRODUCT = 'FORMAÇÃO BAUER | BLACK BAUER VITALÍCIA';
const API = 'https://api.blackcatoficial.com/api';
export class PaymentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const digits = value => String(value ?? '').replace(/\D/g, '');

export function validDocument(value) {
  const n = digits(value);
  if (!/^(\d{11}|\d{14})$/.test(n) || /^(\d)\1+$/.test(n)) return false;
  const check = (base, weights) => {
    const sum = [...base].reduce((s, digit, i) => s + Number(digit) * weights[i], 0);
    return sum % 11 < 2 ? 0 : 11 - sum % 11;
  };
  const weights = n.length === 11 ? [[10,9,8,7,6,5,4,3,2], [11,10,9,8,7,6,5,4,3,2]] : [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]];
  const base = n.slice(0, -2);
  const first = check(base, weights[0]);
  return n.endsWith(`${first}${check(base + first, weights[1])}`);
}

export function customerFrom(input) {
  if (!input || typeof input !== 'object') throw new PaymentError('Preencha os dados da matrícula.');
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const email = String(input.email ?? '').trim();
  let phone = digits(input.phone);
  if (phone.length >= 12 && phone.startsWith('55')) phone = phone.slice(2);
  const document = digits(input.document);
  if (name.length > 150 || !/^\S{2,}\s+\S+/.test(name)) throw new PaymentError('Informe seu nome completo.');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PaymentError('Informe um email válido.');
  if (!/^[1-9]{2}\d{8,9}$/.test(phone)) throw new PaymentError('Informe um telefone válido com DDD.');
  if (!validDocument(document)) throw new PaymentError('Informe um CPF ou CNPJ válido.');
  return { name, email, phone, document: { number: document, type: document.length === 11 ? 'cpf' : 'cnpj' } };
}

function sign(payload, key) { return createHmac('sha256', key).update(payload).digest('base64url'); }
export function paymentToken(id, key, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id, exp: now + 48 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}
export function readToken(token, key, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 2048) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2) throw new Error();
    const [payload, signature] = parts;
    const expected = Buffer.from(sign(payload, key));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.id !== 'string' || !data.id || !Number.isFinite(data.exp) || data.exp <= now) throw new Error();
    return data.id;
  } catch { throw new PaymentError('A sessão de consulta expirou. Confira o pagamento no seu banco.', 401); }
}

async function provider(path, key, fetchImpl, body) {
  let response;
  try {
    response = await fetchImpl(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new PaymentError('Não foi possível confirmar a resposta do Pix. Aguarde antes de tentar novamente.', 504);
  }
  let result;
  try { result = await response.json(); } catch { throw new PaymentError('O serviço de pagamento retornou uma resposta inesperada. Tente novamente mais tarde.', 502); }
  if (!response.ok || result.success !== true || !result.data) {
    throw new PaymentError(response.status === 429 ? 'Muitas tentativas. Aguarde um momento e tente novamente.' : 'Não foi possível gerar ou consultar o Pix. Confira seus dados ou tente novamente mais tarde.', response.status === 429 ? 429 : 502);
  }
  return result.data;
}

export async function createPayment(input, key, fetchImpl = fetch) {
  const customer = customerFrom(input);
  if (!key) throw new PaymentError('Pagamento temporariamente indisponível. Tente novamente mais tarde.', 503);
  // Price and product are controlled exclusively by the server.
  const result = await provider('/sales/create-sale', key, fetchImpl, {
    amount: AMOUNT, currency: 'BRL', paymentMethod: 'pix',
    items: [{ title: PRODUCT, unitPrice: AMOUNT, quantity: 1, tangible: false }],
    customer, pix: { expiresInDays: 1 },
  });
  const data = result.paymentData;
  const code = data?.copyPaste || data?.qrCode;
  if (typeof result.transactionId !== 'string' || typeof code !== 'string' || !code.startsWith('000201')) {
    throw new PaymentError('O serviço não retornou um código Pix válido. Tente novamente mais tarde.', 502);
  }
  if (result.amount !== AMOUNT) throw new PaymentError('O valor retornado pelo serviço de pagamento é inválido.', 502);
  let image = typeof data.qrCodeBase64 === 'string' ? data.qrCodeBase64 : '';
  if (image && !image.startsWith('data:')) image = `data:image/png;base64,${image}`;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image)) image = null;
  return { amount: AMOUNT, code, image, expiresAt: data.expiresAt || null, token: paymentToken(result.transactionId, key) };
}

export async function getPaymentStatus(token, key, fetchImpl = fetch) {
  if (!key) throw new PaymentError('Pagamento temporariamente indisponível.', 503);
  const id = readToken(token, key);
  const result = await provider(`/sales/${encodeURIComponent(id)}/status`, key, fetchImpl);
  if (result.transactionId !== id || result.amount !== AMOUNT) throw new PaymentError('Não foi possível validar este pagamento.', 502);
  const status = String(result.status).toUpperCase();
  if (!['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'].includes(status)) throw new PaymentError('Status de pagamento indisponível.', 502);
  return { status };
}
