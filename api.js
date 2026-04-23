(function () {
  const API_BASE = window.SELFSCAN_API_BASE || 'http://localhost:3000';

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    let body = null;
    try {
      body = isJson ? await response.json() : await response.text();
    } catch (_) {
      body = null;
    }

    if (!response.ok) {
      const message =
        (body && typeof body === 'object' && (body.message || body.error)) ||
        (typeof body === 'string' && body) ||
        `HTTP ${response.status}`;
      throw new Error(message);
    }

    return body;
  }

  const SaleApi = {
    async health() {
      return request('/sale/health', { method: 'GET' });
    },

    async createContext() {
      return request('/sale/context', { method: 'POST' });
    },

    async getContext(contextId) {
      return request(`/sale/context/${encodeURIComponent(contextId)}`, {
        method: 'GET',
      });
    },

    async addItem({ contextId, articleId, quantity }) {
      return request('/sale/items', {
        method: 'POST',
        body: JSON.stringify({
          contextId,
          articleId,
          quantity,
        }),
      });
    },

    async setCustomer({ contextId, rut }) {
      return request('/sale/customer', {
        method: 'POST',
        body: JSON.stringify({
          contextId,
          rut,
        }),
      });
    },

    async totalize(contextId) {
      return request(`/sale/totalize/${encodeURIComponent(contextId)}`, {
        method: 'POST',
      });
    },

    async getPaymentMethods(contextId) {
      return request(
        `/sale/payment-methods/${encodeURIComponent(contextId)}`,
        { method: 'GET' },
      );
    },

    async createPayment({ contextId, method = 402 }) {
      return request('/sale/payments', {
        method: 'POST',
        body: JSON.stringify({
          contextId,
          method,
        }),
      });
    },

    async closeContext(contextId) {
      return request(`/sale/close/${encodeURIComponent(contextId)}`, {
        method: 'POST',
      });
    },
  };

  window.SaleApi = SaleApi;
})();