'use client';

import { useState, useEffect } from 'react';
import AppShell from '../components/AppShell';
import { getInvoices, getInvoicesByCustomer, deleteInvoice, getInvoice } from '@/lib/api';
import { printReceipt, buildReceiptHTML, openReceiptPreview } from '@/lib/print';

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => { loadInvoices(); }, []);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      setInvoices(await getInvoices(200));
      setError('');
    } catch (err: any) { setError(err.message || 'Failed to load'); }
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!search.trim()) return loadInvoices();
    setLoading(true);
    try { setInvoices(await getInvoicesByCustomer(search)); }
    catch (err: any) { setError(err.message || 'Search failed'); }
    setLoading(false);
  };

  const handleReprint = async (invoiceNo: string) => {
    setPrinting(invoiceNo);
    try {
      const inv = await getInvoice(invoiceNo);
      await printReceipt(buildReceiptHTML(inv));
      setStatusMsg('Printed!');
    } catch (err: any) { setStatusMsg('Print failed: ' + err.message); }
    setPrinting(null);
    setTimeout(() => setStatusMsg(''), 3000);
  };

  const handleVoid = async (invoiceNo: string, txType: string) => {
    const msg = txType === 'sale'
      ? `Void invoice ${invoiceNo}? Stock will be reversed.`
      : `Delete record ${invoiceNo}?`;
    if (!window.confirm(msg)) return;
    try {
      await deleteInvoice(invoiceNo);
      setInvoices(prev => prev.filter(i => i.invoice_no !== invoiceNo));
    } catch (err: any) { alert(err.message || 'Failed'); }
  };

  const txBadge = (type: string) => {
    if (type === 'sale') return <span className="sv-badge sv-badge-green">Sale</span>;
    if (type === 'customer_return') return <span className="sv-badge sv-badge-yellow">Cust. Return</span>;
    if (type === 'supplier_return') return <span className="sv-badge sv-badge-purple">Supp. Return</span>;
    if (type === 'used_purchase') return <span className="sv-badge sv-badge-blue">Used Purchase</span>;
    return <span className="sv-badge sv-badge-blue">{type}</span>;
  };

  const statusBadge = (status: string) => {
    if (status === 'paid') return <span className="sv-badge sv-badge-green">Paid</span>;
    if (status === 'partial') return <span className="sv-badge sv-badge-yellow">Partial</span>;
    if (status === 'unpaid') return <span className="sv-badge sv-badge-red">Unpaid</span>;
    return <span className="text-gray-400 text-xs">{status}</span>;
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">Invoices</h1>
            <p className="text-sm text-gray-400">Full transaction history including sales &amp; returns</p>
          </div>
          {statusMsg && <span className="text-sm text-green-400 animate-fadeIn">{statusMsg}</span>}
        </div>

        <div className="sv-card">
          <form onSubmit={handleSearch} className="flex gap-2 mb-5">
            <input
              type="text"
              className="sv-input max-w-sm"
              placeholder="Search by customer name or phone…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button type="submit" className="sv-btn sv-btn-primary">Search</button>
            <button type="button" onClick={() => { setSearch(''); loadInvoices(); }} className="sv-btn sv-btn-ghost">Clear</button>
          </form>

          {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

          <div className="overflow-x-auto">
            <table className="sv-table">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Cashier</th>
                  <th>Type</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-500">Loading…</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-500">No invoices found</td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.invoice_no}>
                    <td className="font-mono text-indigo-300 text-sm">{inv.invoice_no}</td>
                    <td className="text-sm text-gray-300">{new Date(inv.created_at).toLocaleString()}</td>
                    <td>
                      <div className="text-sm">{inv.customer_name || <span className="text-gray-600">—</span>}</div>
                      {inv.customer_phone && <div className="text-xs text-gray-500">{inv.customer_phone}</div>}
                    </td>
                    <td className="text-sm text-gray-400">{inv.cashier || '—'}</td>
                    <td>{txBadge(inv.transaction_type)}</td>
                    <td className="text-right font-medium text-sm">Rs. {fmt(inv.total)}</td>
                    <td>{statusBadge(inv.status)}</td>
                    <td className="text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => handleReprint(inv.invoice_no)}
                          disabled={printing === inv.invoice_no}
                          className="sv-btn sv-btn-ghost py-1 px-2 text-xs"
                        >
                          {printing === inv.invoice_no ? '…' : 'Reprint'}
                        </button>
                        <button
                          onClick={() => handleVoid(inv.invoice_no, inv.transaction_type)}
                          className="sv-btn sv-btn-danger py-1 px-2 text-xs"
                        >
                          Void
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
