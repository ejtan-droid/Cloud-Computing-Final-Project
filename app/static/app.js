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
$('#logout').onclick = guard(async () => { await api('/api/auth/logout', {method: 'POST'}); showAuth(); toast('You are logged out.'); });

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
      <small class="text-muted">${esc(p.sku)} · ${esc(p.category)}</small>
      <div class="d-flex justify-content-between my-2"><span>${peso(p.price)}</span><span><b>${p.quantity}</b> in stock <small class="text-muted">(alert at ${p.low_stock_threshold})</small></span></div>
      <div class="d-flex gap-2"><button class="btn btn-outline-secondary flex-fill" data-edit="${p.id}">Edit</button><button class="btn btn-outline-danger flex-fill" data-del="${p.id}">Delete</button></div>
    </div></div>`).join('') : '<p class="text-muted">No products found. Use “Add product” to create one.</p>';
});
let st; $('#search').oninput = () => { clearTimeout(st); st = setTimeout(loadProducts, 250); };
function openProduct(p) {
  $('#pmTitle').textContent = p ? 'Edit product' : 'Add product';
  $('#pId').value = p?.id || ''; $('#pName').value = p?.name || ''; $('#pSku').value = p?.sku || '';
  $('#pCat').value = p?.category || 'General'; $('#pPrice').value = p?.price ?? ''; $('#pQty').value = p?.quantity ?? '';
  $('#pThr').value = p?.low_stock_threshold ?? 5; productModal.show();
}
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
                quantity: parseInt($('#pQty').value, 10), low_stock_threshold: parseInt($('#pThr').value, 10)};
  await api(id ? '/api/products/' + id : '/api/products', {method: id ? 'PUT' : 'POST', body});
  productModal.hide(); toast(id ? 'Product updated.' : 'Product added.'); loadProducts();
});
$('#delConfirm').onclick = guard(async () => { await api('/api/products/' + delId, {method: 'DELETE'}); delModal.hide(); toast('Product deleted.'); loadProducts(); });

/* ---------- sales ---------- */
function updateTotal() {
  const p = products.find(p => p.id == $('#saleProduct').value), q = parseInt($('#saleQty').value, 10) || 0;
  $('#saleTotal').textContent = peso(p ? p.price * q : 0);
}
const loadSales = guard(async () => {
  const keep = $('#saleProduct').value;
  await fetchProducts();
  $('#saleProduct').innerHTML = products.length ? products.map(p => `<option value="${p.id}" ${p.quantity ? '' : 'disabled'}>${esc(p.name)} — ${p.quantity} in stock · ${peso(p.price)}</option>`).join('') : '<option value="">Add a product first</option>';
  if (keep) $('#saleProduct').value = keep;
  updateTotal();
  const s = await api('/api/sales');
  $('#salesList').innerHTML = s.length ? s.map(x => `<div class="row-item"><div><b>${esc(x.product_name)}</b> × ${x.quantity}<br><small class="text-muted">${when(x.created_at)}</small></div><b>${peso(x.total)}</b></div>`).join('') : '<p class="text-muted mb-0">No sales yet.</p>';
});
$('#saleProduct').onchange = updateTotal; $('#saleQty').oninput = updateTotal;
$('#saleForm').onsubmit = guard(async e => {
  e.preventDefault();
  const r = await api('/api/sales', {method: 'POST', body: {product_id: +$('#saleProduct').value, quantity: parseInt($('#saleQty').value, 10)}});
  toast(`Sale saved: ${peso(r.sale.total)}. ${r.product.name} now has ${r.product.quantity} in stock.` + (r.product.low_stock ? ' Low stock — time to restock!' : ''), r.product.low_stock ? 'warning' : 'success');
  $('#saleQty').value = 1; loadSales();
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
