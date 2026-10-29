const $ = selector => document.querySelector(selector);
const form = $('#checkout-form');
const dialog = $('#pix-dialog');
const button = $('#generate-button');
let payment = null;
let timer = null;
let checking = false;
let terminal = false;

$('.details-toggle').addEventListener('click', event => {
  const toggle = event.currentTarget;
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  $('#product-details').hidden = !open;
});
const digits = value => value.replace(/\D/g, '');
$('#phone').addEventListener('input', event => {
  const v = digits(event.target.value).slice(0, 11);
  event.target.value = v.length > 6 ? `(${v.slice(0,2)}) ${v.slice(2,-4)}-${v.slice(-4)}` : v.length > 2 ? `(${v.slice(0,2)}) ${v.slice(2)}` : v;
});
$('#document').addEventListener('input', event => {
  let v = digits(event.target.value).slice(0,14);
  event.target.value = v.length <= 11 ? v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') : v.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
});
form.addEventListener('input', event => {
  const field = event.target;
  field.removeAttribute('aria-invalid');
  const error = document.getElementById(`${field.id}-error`);
  if (error) error.hidden = true;
});
function validate() {
  const values = Object.fromEntries(new FormData(form));
  const errors = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) ? '' : 'Informe um email válido.',
    phone: /^[1-9]{2}\d{8,9}$/.test(digits(values.phone)) ? '' : 'Informe seu telefone com DDD.',
    name: /^\S{2,}\s+\S+/.test(values.name.trim()) ? '' : 'Informe seu nome completo.',
    document: [11,14].includes(digits(values.document).length) ? '' : 'Informe seu CPF ou CNPJ completo.',
  };
  let first;
  for (const [id, message] of Object.entries(errors)) {
    const element = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    error.textContent = message;
    error.hidden = !message;
    element.setAttribute('aria-invalid', String(Boolean(message)));
    if (message && !first) first = element;
  }
  if (first) { first.focus(); return null; }
  return values;
}
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir. Tente novamente mais tarde.');
  return data;
}
function showPayment() {
  $('#pix-code').value = payment.code;
  const img = $('#qr-image');
  img.hidden = !payment.image;
  if (payment.image) img.src = payment.image;
  img.onerror = () => { img.hidden = true; };
  const expires = new Date(payment.expiresAt);
  $('#expires').textContent = payment.expiresAt && !Number.isNaN(expires.getTime()) ? `Válido até ${expires.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Use o código Pix abaixo para pagar.';
  $('#copy-feedback').textContent = '';
  dialog.showModal();
  if (!terminal) {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) checkStatus(); }, 10000);
  }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  if (payment) { showPayment(); return; }
  const values = validate();
  if (!values) return;
  button.disabled = true;
  $('.spinner').hidden = false;
  $('#generate-label').textContent = 'GERANDO PIX...';
  $('#form-error').hidden = true;
  try {
    payment = await post('/api/pix', values);
    terminal = false;
    // Keep the active Pix only in this page's memory. No browser or database storage.
    for (const input of form.querySelectorAll('input')) input.readOnly = true;
    showPayment();
  } catch (error) {
    $('#form-error').textContent = error.name === 'TimeoutError' || error instanceof TypeError ? 'A conexão foi interrompida. Aguarde um momento antes de tentar novamente.' : error.message;
    $('#form-error').hidden = false;
  } finally {
    button.disabled = false;
    $('.spinner').hidden = true;
    $('#generate-label').textContent = payment ? 'VER MEU PIX' : 'GERAR CÓDIGO QR';
  }
});
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
dialog.addEventListener('close', () => { clearInterval(timer); button.focus(); });
$('#copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(payment.code);
    $('#copy-feedback').textContent = 'Código Pix copiado! Cole no aplicativo do seu banco.';
  } catch {
    $('#pix-code').focus(); $('#pix-code').select();
    $('#copy-feedback').textContent = 'Selecione “Copiar” ou pressione Ctrl+C para copiar o código.';
  }
});
async function checkStatus() {
  if (!payment || checking || terminal) return;
  checking = true;
  $('#check-status').disabled = true;
  try {
    const { status } = await post('/api/status', { token: payment.token });
    const labels = { PENDING: 'Aguardando pagamento', PAID: 'Pagamento confirmado!', CANCELLED: 'Este Pix foi cancelado ou expirou.', REFUNDED: 'Pagamento estornado.' };
    $('#payment-status').textContent = labels[status] || 'Aguardando pagamento';
    $('#payment-status').classList.toggle('paid', status === 'PAID');
    if (status !== 'PENDING') {
      terminal = true; clearInterval(timer);
      $('#payment-content').hidden = true;
      $('#check-status').hidden = true;
      $('#pix-title').textContent = status === 'PAID' ? 'Pagamento confirmado' : 'Status do pagamento';
      $('#pix-description').textContent = status === 'PAID' ? 'Seu pagamento foi recebido com sucesso.' : 'Confira as informações abaixo.';
      $('.modal-heading > p:first-of-type').textContent = status === 'PAID' ? 'PAGAMENTO RECEBIDO' : 'ATUALIZAÇÃO DO PAGAMENTO';
      $('.modal-icon').textContent = status === 'PAID' ? '✓' : '!';
    }
  } catch {
    $('#payment-status').textContent = 'Não foi possível consultar agora. Tente verificar novamente.';
  } finally { checking = false; $('#check-status').disabled = false; }
}
$('#check-status').addEventListener('click', checkStatus);
