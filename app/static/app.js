const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso = n => '₱' + Number(n).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const when = iso => new Date(iso).toLocaleString('en-PH', {dateStyle: 'medium', timeStyle: 'short'});
let products = [], chart = null, delId = null, view = 'dashboard';
const productModal = new bootstrap.Modal('#productModal'), delModal = new bootstrap.Modal('#delModal');

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `alert alert-${type} shadow mb-0`; el.textContent = msg;
  $('#toasts').append(el); setTimeout(() => el.remove(), 4500);
}
function errText(d) {
  if (!d) return '';
  if (typeof d.detail === 'string') return d.detail;
  if (Array.isArray(d.detail)) return d.detail.map(e => `${(e.loc || []).slice(-1)[0] || ''}: ${e.msg}`).join('; ');
  return '';
}
async function api(path, opt = {}) {
  let r;
  try {
    r = await fetch(path, {credentials: 'same-origin', ...opt, headers: {'Content-Type': 'application/json'},
                           body: opt.body ? JSON.stringify(opt.body) : undefined});
  } catch { throw new Error('Cannot reach the server. Check your internet connection.'); }
  let d = null; try { d = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/api/auth/')) showAuth();
    throw new Error(errText(d) || `Request failed (${r.status})`);
  }
  return d;
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'danger'); } };

/* ---------- auth ---------- */
function showAuth() { $('#app').classList.add('d-none'); $('#auth').classList.remove('d-none'); }
function showApp(u) {
  $('#auth').classList.add('d-none'); $('#app').classList.remove('d-none');
  $$('.store-name').forEach(e => e.textContent = u.store_name); $('#whoami').textContent = '@' + u.username;
  go('dashboard');
}
$$('[data-tab]').forEach(b => b.onclick = () => {
  $$('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
  $('#loginForm').classList.toggle('d-none', b.dataset.tab !== 'login');
  $('#regForm').classList.toggle('d-none', b.dataset.tab !== 'register');
});
$('#loginForm').onsubmit = guard(async e => {
  e.preventDefault();
  showApp(await api('/api/auth/login', {method: 'POST', body: {username: $('#lu').value, password: $('#lp').value}}));
  e.target.reset();
});
$('#regForm').onsubmit = guard(async e => {
  e.preventDefault();
  showApp(await api('/api/auth/register', {method: 'POST', body: {store_name: $('#rs').value, username: $('#ru').value, password: $('#rp').value}}));
  e.target.reset();
});

const logoutModal = new bootstrap.Modal('#logoutModal');
$('#logout').onclick = () => {
  const sb = $('#sb'), oc = bootstrap.Offcanvas.getInstance(sb);
  if (oc && sb.classList.contains('show')) {      // phone: close the slide-out menu first
    sb.addEventListener('hidden.bs.offcanvas', () => logoutModal.show(), {once: true});
    oc.hide();
  } else logoutModal.show();                        // desktop: open the popup right away
};
$('#logoutConfirm').onclick = guard(async () => {
  await api('/api/auth/logout', {method: 'POST'});
  logoutModal.hide(); showAuth(); toast('You are logged out.');
});

/* ---------- navigation ---------- */
function go(v) {
  view = v;
  $$('[data-view]').forEach(s => s.classList.toggle('d-none', s.dataset.view !== v));
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === v));
  const oc = bootstrap.Offcanvas.getInstance('#sb'); if (oc) oc.hide();
  ({dashboard: loadDashboard, products: loadProducts, sales: loadSales, reports: loadReport})[v]();
}
$$('[data-nav]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.nav); });

/* ---------- dashboard ---------- */
const lowRow = p => `<div class="row-item"><div><b>${esc(p.name)}</b><br><small class="text-muted">${esc(p.sku)} · alert at ${p.low_stock_threshold}</small></div><span class="badge badge-low align-self-center">${p.quantity} left</span></div>`;
const loadDashboard = guard(async () => {
  const d = await api('/api/dashboard');
  const stat = (n, l, c = '') => `<div class="col-6 col-lg-3"><div class="stat ${c} h-100"><div class="num">${n}</div><small>${l}</small></div></div>`;
  $('#stats').innerHTML = stat(d.total_products, 'Products') + stat(d.total_stock, 'Units in stock') +
    stat(d.low_stock_count, 'Low-stock products', d.low_stock_count ? 'warn' : '') +
    stat(peso(d.sales_today), `Sales today (${d.transactions_today} sales)`);
  $('#lowList').innerHTML = d.low_stock.length ? d.low_stock.map(lowRow).join('') : '<p class="text-muted mb-0">All products are above their low-stock level.</p>';
  const labels = d.chart.map(x => new Date(x.date + 'T00:00').toLocaleDateString('en-PH', {weekday: 'short', day: 'numeric'}));
  if (chart) chart.destroy();
  if (window.Chart) chart = new Chart($('#chart'), {type: 'bar', data: {labels, datasets: [{label: 'Sales (₱)', data: d.chart.map(x => x.total), backgroundColor: '#0f5c5c', borderRadius: 4}]},
    options: {responsive: true, maintainAspectRatio: false, plugins: {legend: {display: false}}, scales: {y: {beginAtZero: true}}}});
});

/* ---------- products ---------- */
async function fetchProducts(q = '') { products = await api('/api/products?q=' + encodeURIComponent(q)); return products; }
const loadProducts = guard(async () => {
  await fetchProducts($('#search').value);
  $('#productList').innerHTML = products.length ? products.map(p => `
    <div class="col-12 col-md-6 col-xl-4"><div class="pcard h-100">
      <div class="d-flex justify-content-between gap-2"><h3>${esc(p.name)}</h3>
        <span class="badge ${p.low_stock ? 'badge-low' : 'badge-ok'} align-self-start">${p.low_stock ? 'Low stock' : 'In stock'}</span></div>
      <small class="text-muted">${esc(p.sku)} · ${esc(p.category)}${p.barcode ? ' · Barcode ' + esc(p.barcode) : ''}</small>
      <div class="d-flex justify-content-between my-2"><span>${peso(p.price)}</span><span><b>${p.quantity}</b> in stock <small class="text-muted">(alert at ${p.low_stock_threshold})</small></span></div>
      <div class="d-flex gap-2"><button class="btn btn-outline-secondary flex-fill" data-edit="${p.id}">Edit</button><button class="btn btn-outline-danger flex-fill" data-del="${p.id}">Delete</button></div>
    </div></div>`).join('') : '<p class="text-muted">No products found. Use “Add product” to create one.</p>';
});
let st; $('#search').oninput = () => { clearTimeout(st); st = setTimeout(loadProducts, 250); };
function openProduct(p) {
  $('#pmTitle').textContent = p ? 'Edit product' : 'Add product';
  $('#pId').value = p?.id || ''; $('#pName').value = p?.name || ''; $('#pSku').value = p?.sku || '';
  $('#pCat').value = p?.category || 'General'; $('#pPrice').value = p?.price ?? ''; $('#pQty').value = p?.quantity ?? '';
  $('#pBarcode').value = p?.barcode || '';
  $('#pThr').value = p?.low_stock_threshold ?? 5; productModal.show();
}
// USB scanners press Enter after each scan: don't submit the form by accident
$('#pBarcode').addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });

$('#addProduct').onclick = () => openProduct(null);
$('#productList').onclick = e => {
  const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
  if (ed) openProduct(products.find(p => p.id == ed.dataset.edit));
  if (del) { const p = products.find(p => p.id == del.dataset.del); delId = p.id; $('#delName').textContent = p.name; delModal.show(); }
};
$('#productForm').onsubmit = guard(async e => {
  e.preventDefault();
  const id = $('#pId').value;
  const body = {name: $('#pName').value, sku: $('#pSku').value, category: $('#pCat').value, price: $('#pPrice').value,
                quantity: parseInt($('#pQty').value, 10), low_stock_threshold: parseInt($('#pThr').value, 10),
                barcode: $('#pBarcode').value.trim() || null};
  await api(id ? '/api/products/' + id : '/api/products', {method: id ? 'PUT' : 'POST', body});
  productModal.hide(); toast(id ? 'Product updated.' : 'Product added.'); loadProducts();
});
$('#delConfirm').onclick = guard(async () => { await api('/api/products/' + delId, {method: 'DELETE'}); delModal.hide(); toast('Product deleted.'); loadProducts(); });

/* ---------- barcode scanning (camera) ---------- */
const scanModalEl = $('#scanModal'), scanModal = new bootstrap.Modal(scanModalEl);
const unknownModalEl = $('#unknownModal'), unknownModal = new bootstrap.Modal(unknownModalEl);
let scanner = null, scanFinish = null, unknownCode = '', lastScan = {code: '', at: 0};
const hideModal = (m, el) => new Promise(r => { el.addEventListener('hidden.bs.modal', r, {once: true}); m.hide(); });
const cleanCode = c => { c = String(c || '').trim(); return /^[0-9A-Za-z-]{1,64}$/.test(c) ? c : ''; };

function scanBarcode(onEach) {   // onEach (optional): keep the camera open and call it for every code.
  return new Promise(resolve => {
    lastScan = {code: '', at: 0};
    let finished = false;
    scanFinish = async code => {
      if (finished) return; finished = true;
      try { if (scanner && scanner.isScanning) await scanner.stop(); if (scanner) scanner.clear(); } catch {}
      scanner = null;
      scanModalEl.addEventListener('hidden.bs.modal', () => resolve(code), {once: true});
      scanModal.hide();
    };
    $('#scanMsg').textContent = 'Starting camera…';
    scanModalEl.addEventListener('shown.bs.modal', async () => {
      if (!window.Html5Qrcode) { $('#scanMsg').textContent = 'The scanner could not load. Cancel and type the barcode instead.'; return; }
      try {
        const F = Html5QrcodeSupportedFormats;
        scanner = new Html5Qrcode('reader', {verbose: false, experimentalFeatures: {useBarcodeDetector: true},
          formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39]});
        await scanner.start({facingMode: 'environment'},
          {fps: 10, qrbox: (w, h) => ({width: Math.floor(w * 0.85), height: Math.floor(Math.min(h * 0.6, 160))})},
          text => {
            lastScan = {code: text.trim(), at: Date.now()};
            if (onEach) onEach(lastScan.code);
          }, () => {});
        $('#scanMsg').textContent = 'Point the camera at the barcode.';
      } catch {
        $('#scanMsg').textContent = 'Camera unavailable. Allow camera permission (the site must use https), or cancel and type the barcode.';
      }
    }, {once: true});
    scanModal.show();
  });
}
$('#scanCancel').onclick = () => scanFinish && scanFinish(null);

async function findByBarcode(code) {   // returns the product, or null when the barcode is not registered
  try { return await api('/api/products/barcode/' + encodeURIComponent(code)); }
  catch (e) { if (/No product has that barcode/.test(e.message)) return null; throw e; }
}
async function handleBarcode(raw) {    // used by the camera button and by USB scanners in the search box
  const code = cleanCode(raw);
  if (!code) { toast('That code is not a supported barcode.', 'warning'); return; }
  $('#search').value = code;
  const p = await findByBarcode(code);
  await loadProducts();
  if (p) { toast('Found: ' + p.name); return; }
  unknownCode = code; $('#unkCode').textContent = code; unknownModal.show();
}
$('#searchScan').onclick = guard(async () => { const c = await scanBarcode(); if (c) await handleBarcode(c); });
$('#search').addEventListener('keydown', guard(async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault(); clearTimeout(st);
  const v = $('#search').value.trim();
  if (/^\d{8,}$/.test(v)) await handleBarcode(v); else await loadProducts();   // long number = scanned barcode
}));
$('#unkAdd').onclick = guard(async () => {
  await hideModal(unknownModal, unknownModalEl);
  openProduct(null); $('#pBarcode').value = unknownCode; $('#search').value = ''; loadProducts();
});
$('#pScan').onclick = guard(async () => {   // scan inside the Add/Edit form
  let code = null;
  await hideModal(productModal, $('#productModal'));   // hide the form while the camera is open
  try { code = await scanBarcode(); } finally { productModal.show(); }
  if (!code) return;
  const c = cleanCode(code);
  if (!c) { toast('That code is not a supported barcode.', 'warning'); return; }
  $('#pBarcode').value = c;
  const hit = await findByBarcode(c);
  if (hit && String(hit.id) !== $('#pId').value) toast(`Warning: this barcode already belongs to "${hit.name}".`, 'warning');
});

/* ---------- sales: the bill (cart) ---------- */
let bill = [], busy = false;
const cents = n => Math.round(n * 100);
const stockOf = l => products.find(p => p.id === l.id)?.quantity ?? 0;
const lineTotal = l => l.price * l.qty;
const billTotal = () => bill.reduce((s, l) => s + lineTotal(l), 0);

function searchResults() {
  const q = $('#saleSearch').value.trim().toLowerCase();
  if (!q) return [];
  return products.filter(p => [p.name, p.sku, p.category, p.barcode].some(v => (v || '').toLowerCase().includes(q))).slice(0, 8);
}
function renderResults() {
  const q = $('#saleSearch').value.trim(), r = searchResults();
  $('#saleResults').innerHTML = !q ? '' : r.length ? r.map(p => `
    <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between gap-2" data-add="${p.id}" ${p.quantity ? '' : 'disabled'}>
      <span><b>${esc(p.name)}</b><br><small class="text-muted">${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</small></span>
      <span class="text-end">${peso(p.price)}<br><small class="${p.quantity ? 'text-muted' : 'text-danger'}">${p.quantity ? p.quantity + ' in stock' : 'Out of stock'}</small></span>
    </button>`).join('') : '<div class="text-muted small">No matching product.</div>';
}
function addToBill(id) {
  const p = products.find(p => p.id == id); if (!p) return;
  const line = bill.find(l => l.id === p.id);
  if (line) {
    if (line.qty >= p.quantity) { toast(`Only ${p.quantity} of ${p.name} in stock.`, 'warning'); return; }
    line.qty++;
  } else if (p.quantity < 1) { toast(p.name + ' is out of stock.', 'warning'); return; }
  else bill.push({id: p.id, name: p.name, price: p.price, qty: 1});
  renderBill();
}
function renderBill() {
  $('#billLines').innerHTML = bill.length ? bill.map(l => `
    <div class="bill-line">
      <div class="bill-name"><b>${esc(l.name)}</b><br><small class="text-muted">${peso(l.price)} each</small></div>
      <div class="qty-box">
        <button type="button" class="btn btn-outline-secondary" data-act="dec" data-id="${l.id}" aria-label="Less">−</button>
        <input type="number" class="form-control" min="1" max="${stockOf(l)}" value="${l.qty}" data-qty="${l.id}" inputmode="numeric" aria-label="Quantity">
        <button type="button" class="btn btn-outline-secondary" data-act="inc" data-id="${l.id}" aria-label="More">+</button>
      </div>
      <div class="bill-sum"><b>${peso(lineTotal(l))}</b><button type="button" class="btn btn-sm btn-link text-danger" data-act="del" data-id="${l.id}">Remove</button></div>
    </div>`).join('') : '<p class="text-muted mb-0">No items yet. Search for a product above.</p>';
  updateTotals();
}
function updateTotals() {
  const t = billTotal(), cash = parseFloat($('#cashIn').value), hasCash = !isNaN(cash);
  $('#billTotal').textContent = peso(t);
  $('#changeOut').innerHTML = !hasCash ? '—' : cents(cash) >= cents(t) ? peso(cash - t) : `<span class="text-danger">Short by ${peso(t - cash)}</span>`;
  $('#checkoutBtn').disabled = busy || !bill.length || (hasCash && cents(cash) < cents(t));
}
$('#saleSearch').oninput = renderResults;
$('#saleResults').onclick = e => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  addToBill(b.dataset.add); $('#saleSearch').value = ''; renderResults(); $('#saleSearch').focus();
};
$('#saleSearch').addEventListener('keydown', e => {   // Enter (e.g. from a USB scanner) adds the matching product
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = $('#saleSearch').value.trim(); if (!q) return;
  const r = searchResults(), pick = products.find(p => p.barcode && p.barcode === q) || (r.length === 1 ? r[0] : null);
  if (pick) { addToBill(pick.id); $('#saleSearch').value = ''; renderResults(); }
  else toast(r.length ? 'Tap the product you want from the list.' : `No product found for "${q}".`, 'warning');
});
$('#billLines').onclick = e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const l = bill.find(x => x.id === +b.dataset.id); if (!l) return;
  if (b.dataset.act === 'del') bill = bill.filter(x => x !== l);
  else if (b.dataset.act === 'inc') { if (l.qty >= stockOf(l)) toast(`Only ${stockOf(l)} of ${l.name} in stock.`, 'warning'); else l.qty++; }
  else if (l.qty > 1) l.qty--;
  renderBill();
};
$('#billLines').onchange = e => {
  const i = e.target.closest('[data-qty]'); if (!i) return;
  const l = bill.find(x => x.id === +i.dataset.qty); if (!l) return;
  let q = parseInt(i.value, 10); if (!(q >= 1)) q = 1;
  if (q > stockOf(l)) { q = Math.max(stockOf(l), 1); toast(`Only ${q} of ${l.name} in stock.`, 'warning'); }
  l.qty = q; renderBill();
};

function scanToBill(raw) {   // called for every barcode the camera reads; returns the message to show
  const code = cleanCode(raw);
  if (!code) return 'That is not a supported barcode.';
  const p = products.find(p => p.barcode === code);
  if (!p) return `Not registered: ${code}. Keep scanning, or tap Done.`;
  const line = bill.find(l => l.id === p.id);
  if (p.quantity < 1) return `${p.name} is out of stock.`;
  if (line && line.qty >= p.quantity) return `Only ${p.quantity} of ${p.name} in stock.`;
  addToBill(p.id);
  if (navigator.vibrate) navigator.vibrate(80);
  return `✓ ${p.name} × ${bill.find(l => l.id === p.id).qty}. Bill total ${peso(billTotal())}. Scan the next item, or tap Done.`;
}
$('#saleScan').onclick = guard(async () => {
  if (!products.length) await fetchProducts();
  $('#scanCancel').textContent = 'Done';
  try { await scanBarcode(scanToBill); } finally { $('#scanCancel').textContent = 'Cancel'; }
});

$('#cashIn').oninput = updateTotals;
$('#clearBill').onclick = () => { if (bill.length && confirm('Clear the whole bill?')) { bill = []; $('#cashIn').value = ''; renderBill(); } };
$('#checkoutBtn').onclick = guard(async () => {
  if (busy || !bill.length) return;
  busy = true; updateTotals();
  const cash = parseFloat($('#cashIn').value);
  try {
    const r = await api('/api/checkout', {method: 'POST', body: {items: bill.map(l => ({product_id: l.id, quantity: l.qty}))}});
    let msg = `Sale recorded: ${peso(r.total)} (${r.receipt_no}).`;
    if (!isNaN(cash)) msg += ` Change: ${peso(cash - r.total)}.`;
    if (r.low_stock.length) msg += ' Low stock: ' + r.low_stock.map(p => `${p.name} (${p.quantity} left)`).join(', ') + '.';
    toast(msg, r.low_stock.length ? 'warning' : 'success');
    bill = []; $('#cashIn').value = '';
  } catch (e) { await loadSales(); throw e; }   // stock may have changed: refresh, but keep the bill
  finally { busy = false; }
  await loadSales();
});
const loadSales = guard(async () => {
  await fetchProducts();
  bill = bill.filter(l => stockOf(l) > 0);                 // drop deleted / sold-out items
  bill.forEach(l => { const p = products.find(p => p.id === l.id); l.price = p.price; l.name = p.name; l.qty = Math.min(l.qty, p.quantity); });
  renderBill(); renderResults();
    if (matchMedia('(pointer: fine)').matches) $('#saleSearch').focus();   // computers: ready for a USB scanner
  const s = await api('/api/sales?limit=100'), groups = [], seen = {};
  for (const x of s) {                                     // items of one bill share a receipt number
    if (x.receipt_no) {
      const g = seen[x.receipt_no] ||= (groups.push({receipt: x.receipt_no, items: [], total: 0, at: x.created_at}), groups[groups.length - 1]);
      g.items.push(x); g.total += x.total;
    } else groups.push({items: [x], total: x.total, at: x.created_at});
  }
  $('#salesList').innerHTML = groups.slice(0, 20).map(g => `<div class="row-item"><div><b>${g.receipt ? esc(g.receipt) : esc(g.items[0].product_name) + ' × ' + g.items[0].quantity}</b><br><small class="text-muted">${when(g.at)}</small>${g.receipt ? '<br><small>' + g.items.map(i => esc(i.product_name) + ' × ' + i.quantity).join(', ') + '</small>' : ''}</div><b>${peso(g.total)}</b></div>`).join('') || '<p class="text-muted mb-0">No sales yet.</p>';
});

/* ---------- reports ---------- */
const localToday = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
$('#repDate').value = localToday();
const loadReport = guard(async () => {
  const q = `period=${$('#repPeriod').value}&date=${$('#repDate').value || localToday()}`;
  $('#csvLink').href = '/api/reports/csv?' + q;
  const r = await api('/api/reports?' + q);
  $('#report').innerHTML = `<div class="panel mb-3"><h3 class="h6">${r.period[0].toUpperCase() + r.period.slice(1)} report: ${r.start}${r.start !== r.end ? ' to ' + r.end : ''}</h3>
    <div class="row g-2 text-center"><div class="col-4"><b class="fs-5">${peso(r.total_sales)}</b><br><small>Total sales</small></div>
    <div class="col-4"><b class="fs-5">${r.total_quantity}</b><br><small>Units sold</small></div><div class="col-4"><b class="fs-5">${r.transactions}</b><br><small>Transactions</small></div></div></div>
    <div class="panel mb-3"><h3 class="h6">By product</h3>${r.by_product.map(p => `<div class="row-item"><span>${esc(p.product)} × ${p.quantity}</span><b>${peso(p.total)}</b></div>`).join('') || '<p class="text-muted mb-0">No sales in this period.</p>'}</div>
    <div class="panel"><h3 class="h6">Transactions</h3>${r.sales.map(x => `<div class="row-item"><div>${esc(x.product_name)} × ${x.quantity}<br><small class="text-muted">${when(x.created_at)}</small></div><b>${peso(x.total)}</b></div>`).join('') || '<p class="text-muted mb-0">Nothing recorded.</p>'}</div>`;
});
$('#repForm').onsubmit = e => { e.preventDefault(); loadReport(); };
$('#printBtn').onclick = () => window.print();

/* ---------- start ---------- */
(async () => { try { showApp(await api('/api/auth/me')); } catch { showAuth(); } })();
