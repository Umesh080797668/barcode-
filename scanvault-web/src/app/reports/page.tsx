'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '../components/AppShell';
import { getReportData, getReportSummary, getLowStock, getCashierStats, exportCsv } from '@/lib/api';

const fmt = (n: number) => (n || 0).toLocaleString('en', { minimumFractionDigits: 2 });
const fmtInt = (n: number) => (n || 0).toLocaleString('en');

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'lowstock' | 'cashiers'>('sales');
  const [periodType, setPeriodType] = useState<'daily' | 'monthly'>('daily');
  const [days, setDays] = useState(30);

  // Data states
  const [reportData, setReportData] = useState<any[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [cashierStats, setCashierStats] = useState<any[]>([]);

  // UI states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingCsv, setExportingCsv] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'sales') {
        const [sales, sum] = await Promise.all([
          getReportData(periodType, days),
          getReportSummary(days).catch(() => null),
        ]);
        setReportData(Array.isArray(sales) ? sales : (sales?.data || []));
        setSummary(sum);
      } else if (tab === 'lowstock') {
        const list = await getLowStock(5);
        setLowStock(Array.isArray(list) ? list : (list?.data || []));
      } else if (tab === 'cashiers') {
        const stats = await getCashierStats(days);
        setCashierStats(Array.isArray(stats) ? stats : (stats?.data || []));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [tab, periodType, days]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group sales data by period (Date or Month)
  const periodOrder = [...new Set(reportData.map((r) => r.period))];
  const groupedData = reportData.reduce<Record<string, { items: any[]; totalRevenue: number; totalSold: number }>>(
    (acc, row) => {
      const p = row.period || 'Unknown';
      if (!acc[p]) acc[p] = { items: [], totalRevenue: 0, totalSold: 0 };
      acc[p].items.push(row);
      acc[p].totalRevenue += Number(row.revenue) || 0;
      acc[p].totalSold += Number(row.qtySold) || 0;
      return acc;
    },
    {}
  );

  const handleExportCsv = async () => {
    setExportingCsv(true);
    try {
      await exportCsv();
    } catch (err: any) {
      alert('CSV export failed: ' + err.message);
    } finally {
      setExportingCsv(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center flex-wrap gap-4 print:hidden">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Business Reports</h1>
            <p className="text-sm text-gray-400">Sales breakdowns, inventory velocity, low-stock warnings & cashier performance</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              disabled={exportingCsv}
              className="sv-btn sv-btn-ghost text-xs"
            >
              {exportingCsv ? 'Exporting…' : '📥 Export Full CSV'}
            </button>
            <button
              onClick={handlePrint}
              className="sv-btn sv-btn-primary text-xs"
            >
              🖨️ Print / Save PDF
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-800 gap-4 print:hidden">
          <button
            onClick={() => setTab('sales')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'sales' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Sales Breakdown
          </button>
          <button
            onClick={() => setTab('lowstock')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'lowstock' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Low Stock Alerts
          </button>
          <button
            onClick={() => setTab('cashiers')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${tab === 'cashiers' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
          >
            Cashier Performance
          </button>
        </div>

        {/* Controls bar */}
        {tab === 'sales' && (
          <div className="flex items-center justify-between flex-wrap gap-4 bg-gray-900/60 p-3 rounded-xl border border-gray-800 print:hidden">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Group by:</span>
              <div className="flex bg-gray-800 rounded-lg p-0.5 border border-gray-700">
                <button
                  onClick={() => setPeriodType('daily')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${periodType === 'daily' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setPeriodType('monthly')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-all ${periodType === 'monthly' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Monthly
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-medium">Time Window:</span>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="sv-input py-1 px-2.5 text-xs w-auto"
              >
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
                <option value={365}>Last 365 Days</option>
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* ── SALES BREAKDOWN TAB ────────────────────────────────────────── */}
        {tab === 'sales' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            {summary && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4">
                <div className="sv-card p-4">
                  <span className="text-xs text-gray-400 block font-medium">Total Revenue</span>
                  <span className="text-2xl font-bold text-indigo-400 mt-1 block">
                    Rs. {fmt(summary.totalRevenue || summary.revenue || 0)}
                  </span>
                </div>
                <div className="sv-card p-4">
                  <span className="text-xs text-gray-400 block font-medium">Units Sold</span>
                  <span className="text-2xl font-bold text-white mt-1 block">
                    {fmtInt(summary.totalSold || summary.qtySold || 0)}
                  </span>
                </div>
                <div className="sv-card p-4">
                  <span className="text-xs text-gray-400 block font-medium">Invoices Issued</span>
                  <span className="text-2xl font-bold text-emerald-400 mt-1 block">
                    {fmtInt(summary.invoiceCount || summary.count || 0)}
                  </span>
                </div>
                <div className="sv-card p-4">
                  <span className="text-xs text-gray-400 block font-medium">Avg. Basket Value</span>
                  <span className="text-2xl font-bold text-amber-400 mt-1 block">
                    Rs. {fmt(summary.averageInvoiceValue || (summary.totalRevenue && summary.invoiceCount ? summary.totalRevenue / summary.invoiceCount : 0))}
                  </span>
                </div>
              </div>
            )}

            {/* Sales Table Grouped by Period */}
            <div className="sv-card">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-white">
                  {periodType === 'daily' ? 'Daily' : 'Monthly'} Product Sales Breakdown
                </h2>
                <span className="text-xs text-gray-400">{reportData.length} item sales rows</span>
              </div>

              {loading ? (
                <div className="text-center py-12 text-gray-500 text-sm">Loading report data…</div>
              ) : periodOrder.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-sm">No sales records in selected period.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="sv-table text-xs">
                    <thead>
                      <tr>
                        <th>Product Details</th>
                        <th className="text-right">Qty Sold</th>
                        <th className="text-right">Current Stock</th>
                        <th className="text-right">Revenue (Rs.)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodOrder.map((period) => {
                        const group = groupedData[period];
                        return (
                          <div key={period} className="contents">
                            {/* Group Header Row */}
                            <tr className="bg-gray-800/80 font-semibold border-y border-gray-700">
                              <td colSpan={2} className="py-2.5 text-indigo-300">
                                📅 {periodType === 'daily' ? 'Date' : 'Month'}: {period}
                              </td>
                              <td className="text-right text-gray-300 py-2.5">
                                Sold: <span className="text-white font-bold">{fmtInt(group.totalSold)}</span>
                              </td>
                              <td className="text-right text-indigo-400 font-bold py-2.5">
                                Total: Rs. {fmt(group.totalRevenue)}
                              </td>
                            </tr>

                            {/* Item Rows */}
                            {group.items.map((row: any, idx: number) => (
                              <tr key={`${period}-${row.barcode}-${idx}`} className="hover:bg-gray-800/30 transition-colors">
                                <td>
                                  <div className="font-medium text-white">{row.name || 'Unnamed Product'}</div>
                                  <div className="text-[11px] font-mono text-gray-400">{row.barcode}</div>
                                </td>
                                <td className="text-right font-medium text-white">{fmtInt(row.qtySold)}</td>
                                <td className="text-right">
                                  <span className={`font-mono ${Number(row.currentStock) <= 0 ? 'text-red-400 font-bold' : 'text-gray-300'}`}>
                                    {row.currentStock !== undefined ? row.currentStock : '—'}
                                  </span>
                                </td>
                                <td className="text-right font-semibold text-emerald-400 font-mono">
                                  Rs. {fmt(row.revenue)}
                                </td>
                              </tr>
                            ))}
                          </div>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── LOW STOCK TAB ──────────────────────────────────────────────── */}
        {tab === 'lowstock' && (
          <div className="sv-card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-white">Low Stock Warning (≤ 5 units remaining)</h2>
              <span className="text-xs text-gray-400">{lowStock.length} items</span>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500 text-sm">Loading low stock data…</div>
            ) : lowStock.length === 0 ? (
              <div className="text-center py-12 text-green-400 text-sm font-medium">All stock levels are healthy!</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="sv-table text-xs">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th className="text-right">Current Stock</th>
                      <th className="text-right">Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStock.map((prod: any) => {
                      const qty = Number(prod.quantity) || 0;
                      return (
                        <tr key={prod._id || prod.barcode} className="hover:bg-gray-800/40">
                          <td>
                            <div className="font-medium text-white">{prod.name}</div>
                            <div className="text-[11px] font-mono text-gray-400">{prod.barcode}</div>
                          </td>
                          <td className="text-gray-400">{prod.category || 'General'}</td>
                          <td className="text-right font-mono font-bold text-red-400">{qty}</td>
                          <td className="text-right font-mono text-gray-300">Rs. {fmt(prod.price)}</td>
                          <td>
                            {qty === 0 ? (
                              <span className="sv-badge sv-badge-red">OUT OF STOCK</span>
                            ) : (
                              <span className="sv-badge sv-badge-yellow">Low Stock</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── CASHIER PERFORMANCE TAB ───────────────────────────────────── */}
        {tab === 'cashiers' && (
          <div className="sv-card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base font-semibold text-white">Cashier Performance Statistics</h2>
              <span className="text-xs text-gray-400">Past {days} days</span>
            </div>

            {loading ? (
              <div className="text-center py-12 text-gray-500 text-sm">Loading cashier stats…</div>
            ) : cashierStats.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">No cashier data recorded.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="sv-table text-xs">
                  <thead>
                    <tr>
                      <th>Cashier</th>
                      <th className="text-right">Invoices Processed</th>
                      <th className="text-right">Total Revenue Handled</th>
                      <th className="text-right">Avg. Ticket Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashierStats.map((c: any) => (
                      <tr key={c.cashier || c._id} className="hover:bg-gray-800/40">
                        <td className="font-semibold text-white">{c.cashier || c._id || 'Unknown'}</td>
                        <td className="text-right font-mono text-white">{fmtInt(c.invoiceCount || c.count)}</td>
                        <td className="text-right font-mono text-emerald-400 font-bold">
                          Rs. {fmt(c.totalRevenue || c.revenue)}
                        </td>
                        <td className="text-right font-mono text-gray-300">
                          Rs. {fmt(c.totalRevenue && c.invoiceCount ? c.totalRevenue / c.invoiceCount : 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
