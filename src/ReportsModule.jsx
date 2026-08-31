import React, { useState, useEffect } from 'react';
import { formatCurrency, formatNumber } from './utils/format';

export default function ReportsModule({ isActive }) {
    const [type, setType] = useState('daily');
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isActive) return;
        loadData();
    }, [isActive, type]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await window.electronAPI.getReportData(type);
            if (res.success) {
                setData(res.data);
            } else {
                alert('Failed to load reports: ' + res.error);
            }
        } catch (err) {
            alert('Error fetching reports: ' + err.message);
        }
        setLoading(false);
    };

    const periodOrder = [...new Set(data.map(r => r.period))];
    const groupedData = data.reduce((acc, row) => {
        if (!acc[row.period]) acc[row.period] = { items: [], totalRevenue: 0, totalSold: 0 };
        acc[row.period].items.push(row);
        acc[row.period].totalRevenue += row.revenue;
        acc[row.period].totalSold += row.qtySold;
        return acc;
    }, {});

    const handleExportPdf = async () => {
        const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: 'Inter', system-ui, sans-serif; padding: 40px; color: #111827; }
          h1 { text-align: center; color: #1f2937; margin-bottom: 8px; font-size: 28px; }
          .meta { text-align: center; color: #6b7280; margin-bottom: 32px; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
          th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
          th { background-color: #f9fafb; font-weight: 600; color: #4b5563; border-top: 1px solid #e5e7eb; border-bottom: 2px solid #e5e7eb;}
          .text-right { text-align: right; }
          .revenue { font-weight: 600; color: #0284c7; }
          .footer { margin-top: 40px; text-align: right; font-size: 12px; color: #9ca3af; }
          .product-name { font-weight: 600; color: #111827; }
          .barcode { font-size: 12px; color: #6b7280; font-family: monospace; line-height: 1.4; }
        </style>
      </head>
      <body>
        <h1>ScanVault - ${type === 'daily' ? 'Daily' : 'Monthly'} Product Selling Breakdown</h1>
        <div class="meta">Generated on: ${new Date().toLocaleString()}</div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th class="text-right">Sold</th>
              <th class="text-right">Current Stock</th>
              <th class="text-right">Revenue (Rs)</th>
            </tr>
          </thead>
          <tbody>
            ${periodOrder.map(period => {
            const group = groupedData[period];
            return `
              <tr style="background-color: #f3f4f6;">
                <td colspan="4" style="font-weight: 600; padding: 12px;">
                  <div style="display: flex; justify-content: space-between;">
                    <span>📅 ${type === 'daily' ? 'Date' : 'Month'}: ${period}</span>
                    <span style="color: #0284c7;">Total Sold: ${formatNumber(group.totalSold)} | Total Revenue: Rs. ${formatCurrency(group.totalRevenue)}</span>
                  </div>
                </td>
              </tr>
              ${group.items.map(row => `
                <tr>
                  <td>
                    <div class="product-name">${row.name || 'Unknown Item'}</div>
                    <div class="barcode">${row.barcode || ''}</div>
                  </td>
                  <td class="text-right">${formatNumber(row.qtySold)}</td>
                  <td class="text-right">${formatNumber(row.currentStock)}</td>
                  <td class="text-right revenue">${formatCurrency(row.revenue)}</td>
                </tr>
              `).join('')}
              `;
        }).join('')}
          </tbody>
        </table>
        
        <div class="footer">
          ScanVault POS System &copy; ${new Date().getFullYear()}
        </div>
      </body>
      </html>
    `;

        const res = await window.electronAPI.exportReportPdf({
            htmlContent,
            defaultFilename: `scanvault-${type}-breakdown-${new Date().toISOString().slice(0, 10)}.pdf`
        });

        if (!res.success && !res.canceled) {
            alert('Failed to export PDF: ' + res.error);
        }
    };

    if (!isActive) return null;

    return (
        <div className="oos-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="oos-header" style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
                <div className="oos-header-left" style={{ flex: 1 }}>
                    <span className="oos-icon">📊</span>
                    <div>
                        <h2 className="oos-title">Sales & Stock Breakdown</h2>
                        <p className="oos-sub">View daily or monthly selling of each product</p>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div className="reports-tabs" style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <button
                            style={{ background: type === 'daily' ? 'var(--accent)' : 'transparent', color: type === 'daily' ? '#fff' : 'var(--text)', border: 'none', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontWeight: type === 'daily' ? '600' : '400', transition: 'all 0.15s' }}
                            onClick={() => setType('daily')}
                        >
                            Daily
                        </button>
                        <button
                            style={{ background: type === 'monthly' ? 'var(--accent)' : 'transparent', color: type === 'monthly' ? '#fff' : 'var(--text)', border: 'none', padding: '6px 12px', fontSize: '13px', cursor: 'pointer', fontWeight: type === 'monthly' ? '600' : '400', transition: 'all 0.15s' }}
                            onClick={() => setType('monthly')}
                        >
                            Monthly
                        </button>
                    </div>

                    <button className="btn-ghost" onClick={loadData} title="Refresh">
                        <IconRefresh />
                    </button>
                    <button className="btn-accent" onClick={handleExportPdf} disabled={loading || data.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <IconDownload /> Export PDF
                    </button>
                </div>
            </div>

            <div className="oos-table-wrap" style={{ flex: 1, marginTop: '15px', position: 'relative' }}>
                {loading ? (
                    <div className="empty-state" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="spinner" style={{ width: '30px', height: '30px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    </div>
                ) : data.length === 0 ? (
                    <div className="oos-empty" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}>
                        <div className="oos-empty-icon" style={{ fontSize: '32px', marginBottom: '10px' }}>📊</div>
                        <h3 style={{ margin: '0 0 5px 0' }}>No data available</h3>
                        <p style={{ margin: 0, fontSize: '12px' }}>No selling data found for this breakdown.</p>
                    </div>
                ) : (
                    <table className="data-table">
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--surface)' }}>
                            <tr>
                                <th>Product</th>
                                <th style={{ textAlign: 'center', width: '90px' }}>Sold</th>
                                <th style={{ textAlign: 'center', width: '110px' }}>Current Stock</th>
                                <th style={{ textAlign: 'right', width: '140px' }}>Revenue</th>
                            </tr>
                        </thead>
                        <tbody>
                            {periodOrder.map((period) => {
                                const group = groupedData[period];
                                return (
                                    <React.Fragment key={period}>
                                        <tr style={{ background: 'var(--surface2)' }}>
                                            <td colSpan="4" style={{ padding: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>📅 {type === 'daily' ? 'Date' : 'Month'}: {period}</span>
                                                    <span style={{ fontSize: '14px', fontWeight: '600' }}>
                                                        <span style={{ marginRight: '15px' }}>Total Sold: {formatNumber(group.totalSold)}</span>
                                                        <span style={{ color: 'var(--green)' }}>Total Revenue: Rs. {formatCurrency(group.totalRevenue)}</span>
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                        {group.items.map((row, i) => (
                                            <tr key={`${period}-${i}`} className="hover-highlight">
                                                <td style={{ paddingLeft: '30px' }}>
                                                    <div style={{ fontWeight: 600 }}>{row.name || 'Unknown Item'}</div>
                                                    <div className="td-code" style={{ opacity: 0.7, marginTop: '3px' }}>{row.barcode || ''}</div>
                                                </td>
                                                <td style={{ textAlign: 'center', fontWeight: '500' }}>{formatNumber(row.qtySold)}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className="qty-badge">{formatNumber(row.currentStock)}</span>
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--green)' }}>
                                                    Rs. {formatCurrency(row.revenue)}
                                                </td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
            <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .hover-highlight { transition: background-color 0.15s; border-bottom: 1px solid var(--border); }
        .hover-highlight:hover td { background-color: var(--surface2); }
      `}</style>
        </div>
    );
}

function IconDownload() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
    );
}

function IconRefresh() {
    return (
        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l5.25 4.64" />
        </svg>
    );
}
