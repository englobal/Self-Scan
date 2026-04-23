const CLUB_CUSTOMERS = {
  "940316055": {
    "doc": "94.031.605-5",
    "name": "MARCELA MUÑOZ",
    "isClub": true
  },
  "287196377": {
    "doc": "28.719.637-7",
    "name": "EDNEY NAPOLES",
    "isClub": true
  },
  "8123311K": {
    "doc": "8.123.311-K",
    "name": "SOLEDAD RAMOS",
    "isClub": true
  }
};

const CLUB_CUSTOMER_KEYS = Object.fromEntries(
  Object.entries(CLUB_CUSTOMERS).map(([key, value]) => [String(key).toUpperCase(), value])
);
let catalog = [{"code": "273358", "barcode": "4005900140906", "emoji": "☀️", "name": "Protector Solar Facial Gel Crema Oil Control FPS 50+ 50ml", "desc": "Venta directa", "listPrice": 23990, "salePrice": 14990, "discountLabel": "-37%", "promoLabel": "", "format": "50 ml", "requiresPrescription": false, "saleType": "direct", "imageDataUrl": "data:image/webp;base64,UklGRnpjAABXRUJQVlA4IG5jAABQCwKdASroA+gDPkkkkUYioiQjIVMoiIAJCWdu7l/wgGhs8qo2kEL3l17/R6bdWwPIw20JEaulZfbP5P+z9qXvhcy+HPqnxZ/gfm+/0f87wf+M/6Xl1cz/6L+//j984P+P/1Pbt/ZP8h/0/7v8BP6j/8L+0/6j9jPot/x/3j9+H9c/4vqV/nn9z/9f+O94z/f/8b/K/v/8uv7P/av/P/fv9t8hH84/s//R/PTvfv3H9hf9nf//65H7a/Dz/Z/9p/6/9n7RP/q1gr515cPof9L/mPyt89fLr6v/fv23/xP0YfrWc/6P+u8y/5/9tvzH9z/cz/DfRD+8/5f2+eo/xz/vPzV+AX8l/mH+Q/vX7w/3LjGto/4noF+yX07/f/4r8tflb+n/135t+7f2H/5f+O+AL+d/1T/e/4P97fkD/veIT+M/0n7VfAJ/TP7Z/3P8P7w3+F/6v9V/s/3U+BX1F/6f87/qfkb/m39r/6H+B/..."}];

let cart = [];
let currentProduct = null;
let customer = { doc:'', name:'', isClub:false, lookedUp:false };
let selectedMethod = 'qr';
let selectedSubOption = 'redcompra';
let orderCounter = 1001;
let storeCode = '';
let lastSale = null;
let dermoPromptAnswered = false;
let dermoProgramApplied = false;

let stream = null;
let detector = null;
let scanLoopHandle = null;
let toastTimer = null;
let cameraStartInProgress = false;
let cameraRequested = false;
let shouldResumeCamera = false;
let scanningActive = false;
let lastDetectedKey = '';
let lastDetectedAt = 0;

const DERMO_ELIGIBLE_RUT = '8123311K';
const MOCK_VENDOR = { code:'11945', name:'JESSICA FRIAS INOSTROZA', box:'4' };

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(Number(n || 0));

const backendSale = {
  contextId: null,
  context: null,
  paymentMethod: 402,
  receiptNumber: null,
};

function saveBackendState() {
  try {
    localStorage.setItem('selfscan_backend_sale', JSON.stringify(backendSale));
  } catch (_) {}
}

function loadBackendState() {
  try {
    const raw = localStorage.getItem('selfscan_backend_sale');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      backendSale.contextId = data.contextId || null;
      backendSale.context = data.context || null;
      backendSale.paymentMethod = data.paymentMethod || 402;
      backendSale.receiptNumber = data.receiptNumber || null;
    }
  } catch (_) {}
}

async function ensureBackendContext() {
  if (backendSale.contextId) return backendSale.contextId;

  const result = await window.SaleApi.createContext();
  backendSale.contextId = result.contextId;
  saveBackendState();
  return backendSale.contextId;
}

async function refreshBackendContext() {
  if (!backendSale.contextId) return null;
  const result = await window.SaleApi.getContext(backendSale.contextId);
  backendSale.context = result.context;
  saveBackendState();
  return backendSale.context;
}

function mapBackendContextToCart() {
  const ctx = backendSale.context;
  if (!ctx || !ctx.items) return [];

  return Object.values(ctx.items).map((entry) => {
    const p = entry.product || {};
    return {
      code: p.id,
      barcode: Array.isArray(p.barcode) ? p.barcode[0] || p.id : p.id,
      name: p.name || 'Producto',
      desc: p.description || '',
      listPrice: Number(p.price || 0),
      salePrice: Number(
        entry.total?.value && entry.quantity
          ? Number(entry.total.value) / Number(entry.quantity)
          : (p.price || 0)
      ),
      discountLabel: '',
      promoLabel: '',
      format: p.unit || 'Unidad',
      requiresPrescription: false,
      saleType: 'direct',
      imageDataUrl: '',
      qty: Number(entry.quantity || 1),
    };
  });
}

function syncCartFromBackend() {
  cart = mapBackendContextToCart();
  resetConditionalDiscounts();
  renderCart();
  renderPaymentSummary();
}

async function withUiLock(task, loadingText = 'Procesando...') {
  const buttons = Array.from(document.querySelectorAll('button'));
  buttons.forEach((btn) => btn.disabled = true);
  try {
    toast(loadingText, 1200);
    return await task();
  } finally {
    buttons.forEach((btn) => btn.disabled = false);
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLookup(v) {
  return String(v ?? '').trim().toUpperCase();
}

function digitsOnly(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

function getProductDisplayCode(p) {
  const parts = [];
  if (p?.code) parts.push(`SKU ${p.code}`);
  if (p?.barcode) parts.push(`EAN ${p.barcode}`);
  return parts.join(' · ') || 'Sin código';
}

function activeScreenId() {
  return document.querySelector('.screen.active')?.id || 'home';
}

function rutClean(input) {
  return String(input ?? '').toUpperCase().replace(/[^0-9K]/g, '');
}

function rutFormat(clean) {
  const v = rutClean(clean);
  if (!v) return '';
  if (v.length < 2) return v;
  let body = v.slice(0, -1).replace(/^0+/, '') || '0';
  const dv = v.slice(-1);
  body = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${dv}`;
}

function rutBodyNumber(clean) {
  const v = rutClean(clean);
  return v ? v.slice(0, -1) : '';
}

function findClubCustomerByRut(clean) {
  const full = rutClean(clean);
  if (!full) return null;
  const body = rutBodyNumber(full);
  const candidates = [full, body].filter(Boolean);
  for (const key of candidates) {
    if (CLUB_CUSTOMER_KEYS[key]) return CLUB_CUSTOMER_KEYS[key];
  }
  return null;
}

function storeInputNormalize(value) {
  return digitsOnly(value).slice(0, 4);
}

function activeCustomerName() {
  return customer.name || customer.doc || 'CLIENTE';
}

function customerEligibleForDermo() {
  return customer.isClub && rutClean(customer.doc) === DERMO_ELIGIBLE_RUT;
}

function resetConditionalDiscounts() {
  dermoPromptAnswered = false;
  dermoProgramApplied = false;
}

function clearLookupState(options = {}) {
  currentProduct = null;
  if (!options.keepManual && $('manualCode')) $('manualCode').value = '';
  renderSearchStatus();
}

function findProductByLookup(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const q = normalizeLookup(raw);
  const qDigits = digitsOnly(raw);

  for (const p of catalog) {
    const code = normalizeLookup(p.code);
    const barcode = normalizeLookup(p.barcode);
    if (q && (code === q || barcode === q)) return p;
  }

  if (qDigits) {
    for (const p of catalog) {
      const codeDigits = digitsOnly(p.code);
      const barcodeDigits = digitsOnly(p.barcode);
      if (qDigits === barcodeDigits || qDigits === codeDigits) return p;
      if (qDigits.length === 12 && barcodeDigits === `0${qDigits}`) return p;
      if (qDigits.length === 13 && qDigits.startsWith('0') && barcodeDigits === qDigits.slice(1)) return p;
    }
  }

  return null;
}

function calcLineBaseSale(item) {
  const qty = Number(item.qty || 1);
  if (item.saleType === 'bundle2') {
    const pairs = Math.floor(qty / 2);
    const rem = qty % 2;
    return (pairs * Number(item.salePrice || 0)) + (rem * Number(item.listPrice || 0));
  }
  return qty * Number(item.salePrice || 0);
}

function calcClubLineDiscount(item) {
  if (!customer.isClub) return 0;
  return Math.round(calcLineBaseSale(item) * 0.07);
}

function totalList() {
  return cart.reduce((acc, item) => acc + (Number(item.listPrice || 0) * Number(item.qty || 1)), 0);
}

function totalBaseSale() {
  return cart.reduce((acc, item) => acc + calcLineBaseSale(item), 0);
}

function totalOfferDiscount() {
  return totalList() - totalBaseSale();
}

function totalClubDiscount() {
  if (!customer.isClub) return 0;
  return cart.reduce((acc, item) => acc + calcClubLineDiscount(item), 0);
}

function totalDermoDiscount() {
  if (!dermoProgramApplied || !customerEligibleForDermo()) return 0;
  return Math.round(totalBaseSale() * 0.1);
}

function totalFinal() {
  return Math.max(0, totalBaseSale() - totalClubDiscount() - totalDermoDiscount());
}

function toast(message, timeout = 2200) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), timeout);
}

function go(id) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.remove('active');
    screen.classList.add('hidden');
  });
  const next = $(id);
  if (!next) return;
  next.classList.add('active');
  next.classList.remove('hidden');

  if (id === 'scan') onEnterScan();
  if (id === 'cart') renderCart();
  if (id === 'payment') renderPaymentSummary();
  if (id === 'qrpay' && $('orderRef')) $('orderRef').textContent = orderCounter;
  if (id === 'walletpay') updateWalletPayCopy();
  if (id === 'success') renderSuccess();
  if (id === 'receipt') renderReceipt();

  syncCustomerUi();
  syncStoreUi();

  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (_) {
    window.scrollTo(0, 0);
  }
}

function renderSearchStatus(message = '') {
  const container = $('demoList');
  if (!container) return;
  if (currentProduct) {
    const p = currentProduct;
    const clubInfo = customer.isClub ? `<div class="tiny muted" style="margin-top:6px">Cliente Club: 7% extra sobre oferta</div>` : '';
    container.innerHTML = `
      <div class="product-demo">
        <div class="thumb">${p.imageDataUrl ? `<img alt="${escapeHtml(p.name)}" src="${p.imageDataUrl}">` : (p.emoji || '🛒')}</div>
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <p class="muted tiny">${escapeHtml(getProductDisplayCode(p))}</p>
          <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:6px">
            <span class="badge badge-info">Lista ${money(p.listPrice)}</span>
            <span class="badge badge-ok">${p.saleType === 'bundle2' ? escapeHtml(p.promoLabel || `Promo ${money(p.salePrice)}`) : `Oferta ${money(p.salePrice)}`}</span>
            <span class="badge sale-flag">${escapeHtml(p.discountLabel || '-')}</span>
          </div>
          ${clubInfo}
        </div>
        <button class="btn btn-primary btn-small" type="button" onclick="openProductByCode('${escapeHtml(p.barcode || p.code)}')">Abrir</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="banner">
      <div class="icon">🔎</div>
      <div>
        <strong>Esperando producto</strong>
        <div class="tiny">${escapeHtml(message || 'Escanea o escribe un SKU/EAN para mostrar el artículo.')}</div>
      </div>
    </div>
  `;
}

function onEnterScan() {
  renderSearchStatus();
  updateBarcodeSupportBadge();
  syncCustomerUi();
  syncStoreUi();
  if (cameraRequested || shouldResumeCamera) {
    startCamera({ silent: true });
  } else {
    showVideoFallback('Toca el botón scanner para abrir la cámara. Luego el producto se detecta solo.');
  }
}

function renderCatalogAdmin() {
  const count = $('catCount');
  const list = $('catalogList');
  if (count) count.textContent = `${catalog.length} items`;
  if (!list) return;
  list.innerHTML = '';
}

function openProduct(product) {
  if (!product) {
    toast('Producto no encontrado');
    return false;
  }

  currentProduct = product;

  if ($('productHero')) {
    $('productHero').innerHTML = product.imageDataUrl
      ? `<img alt="${escapeHtml(product.name)}" src="${product.imageDataUrl}">`
      : `<div style="font-size:72px">${product.emoji || '🛒'}</div>`;
  }
  if ($('productName')) $('productName').textContent = product.name || 'Producto';
  if ($('productDesc')) $('productDesc').textContent = product.desc || 'Detalle';
  if ($('productListPrice')) $('productListPrice').textContent = money(product.listPrice);
  if ($('productSalePrice')) $('productSalePrice').textContent = product.saleType === 'bundle2'
    ? (product.promoLabel || money(product.salePrice))
    : money(product.salePrice);
  if ($('productDiscount')) $('productDiscount').textContent = product.discountLabel || '-';
  if ($('productCode')) $('productCode').textContent = getProductDisplayCode(product);
  if ($('productFormat')) $('productFormat').textContent = product.format || 'Unidad';

  const clubRow = $('productClubRow');
  const clubPrice = $('productClubPrice');
  if (clubRow && clubPrice) {
    if (customer.isClub) {
      const directClubPrice = product.saleType === 'bundle2'
        ? product.promoLabel || money(Math.round(Number(product.salePrice || 0) * 0.93))
        : money(Math.max(0, Math.round(Number(product.salePrice || 0) * 0.93)));
      clubPrice.textContent = directClubPrice;
      clubRow.classList.remove('hidden');
    } else {
      clubPrice.textContent = '$0';
      clubRow.classList.add('hidden');
    }
  }

  const promo = $('productPromo');
  if (promo) {
    const msgs = [];
    if (product.promoLabel) msgs.push(product.promoLabel);
    if (customer.isClub) msgs.push('Cliente Club: 7% extra sobre el precio oferta');
    if (msgs.length) {
      promo.textContent = msgs.join(' · ');
      promo.classList.remove('hidden');
    } else {
      promo.textContent = '';
      promo.classList.add('hidden');
    }
  }

  renderSearchStatus(`Encontrado: ${product.name}`);
  go('product');
  return true;
}

function openProductByIndex(index) {
  return openProduct(catalog[index]);
}

function openProductByCode(value) {
  const product = findProductByLookup(value);
  if (!product) {
    renderSearchStatus(`No se encontró el código: ${value}`);
    toast(`Código no existe en catálogo: ${value}`, 3000);
    return false;
  }
  return openProduct(product);
}

function scanByCode() {
  const value = $('manualCode')?.value?.trim() || '';
  if (!value) return toast('Ingresa un SKU o código de barras');
  const ok = openProductByCode(value);
  if (ok) toast(`Producto encontrado: ${currentProduct?.name || value}`);
}

async function addCurrentProduct() {
  if (!currentProduct) return toast('Primero selecciona un producto');

  try {
    await withUiLock(async () => {
      const contextId = await ensureBackendContext();

      await window.SaleApi.addItem({
        contextId,
        articleId: String(currentProduct.code),
        quantity: 1,
      });

      await refreshBackendContext();
      syncCartFromBackend();
    }, 'Agregando producto...');

    const name = currentProduct.name;
    clearLookupState();
    toast(`Agregado: ${name}`);
    go('cart');
  } catch (error) {
    console.error(error);
    toast(`No se pudo agregar el producto: ${error.message}`, 3000);
  }
}

async function changeQty(code, delta) {
  if (Number(delta) <= 0) {
    toast('Por ahora solo sumaremos unidades desde el backend');
    return;
  }

  const item = cart.find((x) => x.code === code);
  if (!item) return;

  try {
    await withUiLock(async () => {
      const contextId = await ensureBackendContext();

      await window.SaleApi.addItem({
        contextId,
        articleId: String(code),
        quantity: 1,
      });

      await refreshBackendContext();
      syncCartFromBackend();
    }, 'Actualizando cantidad...');

    toast('Cantidad actualizada');
  } catch (error) {
    console.error(error);
    toast(`No se pudo actualizar la cantidad: ${error.message}`, 3000);
  }
}

function removeItem(code) {
  toast('Quitar ítems lo conectaremos en el siguiente paso');
}

function renderCart() {
  const list = $('cartList');
  if (!list) return;

  if (!cart.length) {
    list.innerHTML = '<p class="muted">Tu orden está vacía.</p>';
  } else {
    list.innerHTML = cart.map((item) => `
      <div class="cart-item">
        <div class="avatar">${item.imageDataUrl ? `<img alt="${escapeHtml(item.name)}" src="${item.imageDataUrl}">` : (item.emoji || '🛒')}</div>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <div class="tiny muted">${escapeHtml(getProductDisplayCode(item))}</div>
          <div class="tiny muted">Cantidad: ${item.qty}</div>
          <div class="tiny muted">Precio lista unitario: ${money(item.listPrice)}</div>
          <div class="tiny muted">Precio oferta aplicado: ${money(calcLineBaseSale(item))}</div>
          <div class="tiny muted">Descuento oferta: ${money((Number(item.listPrice || 0) * Number(item.qty || 1)) - calcLineBaseSale(item))}</div>
          ${customer.isClub ? `<div class="tiny muted">Descuento club 7%: ${money(calcClubLineDiscount(item))}</div>` : ''}
        </div>
        <div class="stack" style="min-width:96px">
          <button class="btn btn-secondary btn-small" type="button" onclick="changeQty('${escapeHtml(item.code)}', 1)">+1</button>
          <button class="btn btn-secondary btn-small" type="button" onclick="removeItem('${escapeHtml(item.code)}')">Quitar</button>
        </div>
      </div>
    `).join('');
  }

  if ($('subtotal')) $('subtotal').textContent = money(totalList());
  if ($('saleDiscount')) $('saleDiscount').textContent = money(totalOfferDiscount());
  if ($('clubDiscount')) $('clubDiscount').textContent = money(totalClubDiscount());
  if ($('discount')) $('discount').textContent = money(totalOfferDiscount() + totalClubDiscount() + totalDermoDiscount());
  if ($('total')) $('total').textContent = money(totalFinal());

  const dermoRow = $('dermoRow');
  if (dermoRow) dermoRow.classList.toggle('hidden', !totalDermoDiscount());
  if ($('dermoDiscount')) $('dermoDiscount').textContent = money(totalDermoDiscount());

  if ($('cartDermoHint')) {
    if (customerEligibleForDermo()) {
      $('cartDermoHint').textContent = dermoProgramApplied
        ? `Programa DermoCosmética aplicado: ${money(totalDermoDiscount())}`
        : 'Cliente con saldo disponible en programa DermoCosmética';
    } else {
      $('cartDermoHint').textContent = 'Sin beneficios adicionales pendientes';
    }
  }
}

async function connectCustomerByRut(rutRaw) {
  const rut = String(rutRaw || '')
    .replace(/\./g, '')
    .replace(/-/g, '')
    .trim()
    .toUpperCase();

  if (!rut) {
    toast('Ingresa un RUT');
    return;
  }

  try {
    await withUiLock(async () => {
      const contextId = await ensureBackendContext();

      await window.SaleApi.setCustomer({
        contextId,
        rut,
      });

      await refreshBackendContext();
      syncCartFromBackend();
    }, 'Asociando cliente...');

    const normalized = CLUB_CUSTOMER_KEYS[rut];
    if (normalized) {
      customer.name = normalized.name;
      customer.doc = normalized.doc;
      customer.isClub = !!normalized.isClub;
    } else {
      customer.name = `Cliente ${rut}`;
      customer.doc = rut;
      customer.isClub = false;
    }
    customer.lookedUp = true;

    syncCustomerUi();
    toast('Cliente asociado');
    go('cart');
  } catch (error) {
    console.error(error);
    toast(`No se pudo asociar el cliente: ${error.message}`, 3000);
  }
}

function clearCustomer() {
  customer = { doc:'', name:'', isClub:false, lookedUp:false };
  if ($('customerDoc')) $('customerDoc').value = '';
  resetConditionalDiscounts();
  syncCustomerUi();
  renderCart();
  if (currentProduct) openProduct(currentProduct);
  toast('Cliente eliminado');
}

function syncCustomerUi() {
  const name = customer.name || customer.doc || 'Invitado';
  const isKnown = Boolean(customer.lookedUp);
  const isClub = Boolean(customer.isClub);

  if ($('cartCustomerHint')) $('cartCustomerHint').textContent = isKnown ? `${name}${isClub ? ' · Club' : ' · No Club'}` : 'No ingresado';
  if ($('successCustomer')) $('successCustomer').textContent = name;
  if ($('successGreetingName')) $('successGreetingName').textContent = name;
  if ($('receiptCustomerName')) $('receiptCustomerName').textContent = name;

  const navLabel = isKnown ? 'Cambiar cliente' : 'Ingresar cliente';
  if ($('scanCustomerNavBtn')) $('scanCustomerNavBtn').textContent = navLabel;
  if ($('cartCustomerNavBtn')) $('cartCustomerNavBtn').textContent = navLabel;
  if ($('lookupCustomerBtn')) $('lookupCustomerBtn').textContent = isKnown ? 'Actualizar cliente' : 'Aplicar cliente';
  if ($('clearCustomerBtn')) $('clearCustomerBtn').classList.toggle('hidden', !isKnown);
}

function syncStoreUi() {
  const label = storeCode ? `Local ${storeCode}` : 'Local no informado';
  if ($('storeDisplayScan')) $('storeDisplayScan').textContent = label;
  if ($('cartStoreHint')) $('cartStoreHint').textContent = label;
  if ($('paymentStoreText')) $('paymentStoreText').textContent = label;
}

function renderPaymentSummary() {
  if ($('paymentTotal')) $('paymentTotal').textContent = money(totalFinal());
  if ($('paymentSubtotal')) $('paymentSubtotal').textContent = money(totalList());
  if ($('paymentOfferDiscount')) $('paymentOfferDiscount').textContent = money(totalOfferDiscount());
  if ($('paymentClubDiscount')) $('paymentClubDiscount').textContent = money(totalClubDiscount());
  if ($('paymentCustomerText')) $('paymentCustomerText').textContent = customer.name || customer.doc || 'Invitado';
  const dermoRow = $('paymentDermoRow');
  if (dermoRow) dermoRow.classList.toggle('hidden', !totalDermoDiscount());
  if ($('paymentDermoDiscount')) $('paymentDermoDiscount').textContent = money(totalDermoDiscount());
  if ($('paymentDermoHint')) $('paymentDermoHint').textContent = totalDermoDiscount()
    ? `Canje DermoCosmética aplicado: ${money(totalDermoDiscount())}`
    : 'Sin canjes especiales';
}

function updateWalletPayCopy() {}
function renderSuccess() {}
function renderReceipt() {}
function updateBarcodeSupportBadge() {}
function showVideoFallback(message) { if ($('videoFallback')) $('videoFallback').textContent = message; }
async function startCamera() {}

function bindEvents() {
  $('manualSearchBtn')?.addEventListener('click', scanByCode);
  $('addProductBtn')?.addEventListener('click', addCurrentProduct);
  $('lookupCustomerBtn')?.addEventListener('click', () => connectCustomerByRut($('customerDoc')?.value || ''));
  $('clearCustomerBtn')?.addEventListener('click', clearCustomer);
  $('goPaymentBtn')?.addEventListener('click', () => go('payment'));
  $('goScanBtn')?.addEventListener('click', () => go('scan'));
  $('customerDoc')?.addEventListener('input', (e) => {
    const clean = rutClean(e.target.value);
    e.target.value = rutFormat(clean);
  });
  $('storeCode')?.addEventListener('input', (e) => {
    storeCode = storeInputNormalize(e.target.value);
    e.target.value = storeCode;
    syncStoreUi();
  });
  document.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => go(btn.dataset.go));
  });
}

function init() {
  loadBackendState();
  syncStoreUi();
  syncCustomerUi();
  renderCart();
  renderPaymentSummary();
  renderSearchStatus();
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
