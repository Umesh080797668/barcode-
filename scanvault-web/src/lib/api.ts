/**
 * lib/api.ts — centralised API client.
 * Function names mirror the old electronAPI calls for minimal diff in ported components.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Auth token management ────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sv_token');
}

export function setToken(token: string) {
  localStorage.setItem('sv_token', token);
}

export function clearToken() {
  localStorage.removeItem('sv_token');
  localStorage.removeItem('sv_user');
}

export function getUser(): { username: string; role: string; name: string } | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('sv_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setUser(user: { username: string; role: string; name: string }) {
  localStorage.setItem('sv_user', JSON.stringify(user));
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

export async function fetchApi<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired — please log in again');
  }

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body?.message ?? message;
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

/** Streaming fetch for file downloads (CSV export) */
export async function downloadFile(endpoint: string, filename: string) {
  const token = getToken();
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

export async function login(username: string, password: string) {
  const data = await fetchApi<{ access_token: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.access_token);
  setUser(data.user);
  return data;
}

export function logout() {
  clearToken();
  if (typeof window !== 'undefined') window.location.href = '/login';
}

// ─── Products API — names mirror old electronAPI ──────────────────────────────

/** @alias electronAPI.getProducts */
export const getProducts = (params?: { category?: string; search?: string }) => {
  const qs = params
    ? '?' + new URLSearchParams(params as Record<string, string>).toString()
    : '';
  return fetchApi(`/products${qs}`);
};

/** @alias electronAPI.getProduct */
export const getProduct = (barcode: string) => fetchApi(`/products/${encodeURIComponent(barcode)}`);

/** @alias electronAPI.generateBarcode */
export const generateBarcode = async (): Promise<{ barcode: string }> => {
  const res = await fetchApi<any>('/products/generate-barcode');
  if (typeof res === 'string') return { barcode: res };
  if (res && typeof res.barcode === 'string') return { barcode: res.barcode };
  return { barcode: String(res?.barcode || res || '') };
};

/** @alias electronAPI.saveProduct — creates or updates (uses PATCH for update when id present) */
export const saveProduct = (data: any) => {
  if (data._id) {
    return fetchApi(`/products/${data._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data, expectedVersion: data.__v ?? 0 }),
    });
  }
  return fetchApi('/products', { method: 'POST', body: JSON.stringify(data) });
};

/** @alias electronAPI.deleteProduct */
export const deleteProduct = (id: string) => fetchApi(`/products/${id}`, { method: 'DELETE' });

// ─── Invoices API ─────────────────────────────────────────────────────────────

/** @alias electronAPI.getInvoices */
export const getInvoices = (limit?: number) =>
  fetchApi(`/invoices${limit ? `?limit=${limit}` : ''}`);

/** @alias electronAPI.getInvoicesByCustomer */
export const getInvoicesByCustomer = (term: string) =>
  fetchApi(`/invoices/search?customer=${encodeURIComponent(term)}`);

/** @alias electronAPI.getInvoice */
export const getInvoice = (invoiceNo: string) =>
  fetchApi(`/invoices/${encodeURIComponent(invoiceNo)}`);

/** @alias electronAPI.saveInvoice — cashier field is ignored server-side, derived from JWT */
export const saveInvoice = (data: any) =>
  fetchApi('/invoices', { method: 'POST', body: JSON.stringify(data) });

/** @alias electronAPI.updateInvoice */
export const updateInvoice = (invoiceNo: string, data: any) =>
  fetchApi(`/invoices/${encodeURIComponent(invoiceNo)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

/** @alias electronAPI.deleteInvoice */
export const deleteInvoice = (invoiceNo: string) =>
  fetchApi(`/invoices/${encodeURIComponent(invoiceNo)}`, { method: 'DELETE' });

// ─── Supplier Returns API ─────────────────────────────────────────────────────

/** @alias electronAPI.getSupplierReturns */
export const getSupplierReturns = (limit?: number) =>
  fetchApi(`/supplier-returns${limit ? `?limit=${limit}` : ''}`);

/** @alias electronAPI.saveSupplierReturn */
export const saveSupplierReturn = (data: any) =>
  fetchApi('/supplier-returns', { method: 'POST', body: JSON.stringify(data) });

/** @alias electronAPI.receiveSupplierReplacement */
export const receiveSupplierReplacement = (id: string, data?: any) =>
  fetchApi(`/supplier-returns/${id}/receive`, {
    method: 'PATCH',
    body: JSON.stringify(data ?? {}),
  });

// ─── Custom Fields API ────────────────────────────────────────────────────────

/** @alias electronAPI.getCustomFields */
export const getCustomFields = () => fetchApi('/custom-fields');

/** @alias electronAPI.saveCustomField */
export const saveCustomField = (data: any) =>
  fetchApi('/custom-fields', { method: 'POST', body: JSON.stringify(data) });

/** @alias electronAPI.deleteCustomField */
export const deleteCustomField = (id: string) =>
  fetchApi(`/custom-fields/${id}`, { method: 'DELETE' });

// ─── Reports API ─────────────────────────────────────────────────────────────

/** @alias electronAPI.getReportData — type: 'daily' | 'monthly' */
export const getReportData = (type: 'daily' | 'monthly', days?: number) =>
  fetchApi(`/reports/data?type=${type}${days ? `&days=${days}` : ''}`);

export const getReportSummary = (days?: number) =>
  fetchApi(`/reports/summary${days ? `?days=${days}` : ''}`);

export const getLowStock = (threshold?: number) =>
  fetchApi(`/reports/low-stock${threshold !== undefined ? `?threshold=${threshold}` : ''}`);

export const getCashierStats = (days?: number) =>
  fetchApi(`/reports/cashiers${days ? `?days=${days}` : ''}`);

// ─── Backup / Export API ──────────────────────────────────────────────────────

/** @alias electronAPI trigger — fires backup cron immediately */
export const createBackup = () => fetchApi('/backup/run', { method: 'POST' });

/** Downloads a full CSV export to the browser */
export const exportCsv = () => {
  const date = new Date().toISOString().slice(0, 10);
  return downloadFile('/backup/export.csv', `oshini-store-export-${date}.csv`);
};

// ─── Users API (owner only) ───────────────────────────────────────────────────

export const getUsers = () => fetchApi('/users');
export const createUser = (data: any) =>
  fetchApi('/users', { method: 'POST', body: JSON.stringify(data) });
export const updateUser = (id: string, data: any) =>
  fetchApi(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const resetUserPassword = (id: string, password: string) =>
  fetchApi(`/users/${id}/reset-password`, {
    method: 'PATCH',
    body: JSON.stringify({ password }),
  });
export const deactivateUser = (id: string) =>
  fetchApi(`/users/${id}`, { method: 'DELETE' });
