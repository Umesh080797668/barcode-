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
        <div className="oos-panel">
            <div className="oos-header">
                <div className="oos-header-left">
                    <span className="oos-icon">📊</span>
                    <div>
                        <h2 className="oos-title">Sales & Stock Breakdown</h2>
                        <p className="oos-sub">View daily or monthly selling of each product</p>
                    </div>
                </div>

                <div className="reports-toolbar">
                    <div className="reports-type-toggle">
                        <button
                            className={`reports-type-btn ${type === 'daily' ? 'active' : ''}`}
                            onClick={() => setType('daily')}
                        >
                            Daily
                        </button>
                        <button
                            className={`reports-type-btn ${type === 'monthly' ? 'active' : ''}`}
                            onClick={() => setType('monthly')}
                        >
                            Monthly
                        </button>
                    </div>

                    <button className="btn-ghost" onClick={loadData} title="Refresh">
                        <IconRefresh />
                    </button>
                    <button className="btn-accent" onClick={handleExportPdf} disabled={loading || data.length === 0}>
                        <IconDownload /> Export PDF
                    </button>
                </div>
            </div>

            <div className="reports-body">
                {loading ? (
                    <div className="reports-loading">
                        <div className="spinner" />
                    </div>
                ) : data.length === 0 ? (
                    <div className="oos-empty">
                        <div className="oos-empty-icon">📊</div>
                        <h3>No data available</h3>
                        <p>No selling data found for this breakdown.</p>
                    </div>
                ) : (
                    <div className="reports-table-scroll">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Product</th>
                                    <th className="ta-center" style={{ width: '90px' }}>Sold</th>
                                    <th className="ta-center" style={{ width: '110px' }}>Current Stock</th>
                                    <th className="ta-right" style={{ width: '140px' }}>Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                {periodOrder.map((period) => {
                                    const group = groupedData[period];
                                    return (
                                        <React.Fragment key={period}>
                                            <tr className="reports-group-row">
                                                <td colSpan="4">
                                                    <div className="reports-group-bar">
                                                        <span className="reports-group-label">📅 {type === 'daily' ? 'Date' : 'Month'}: {period}</span>
                                                        <span className="reports-group-stats">
                                                            <span>Total Sold: {formatNumber(group.totalSold)}</span>
                                                            <span className="value-revenue">Total Revenue: Rs. {formatCurrency(group.totalRevenue)}</span>
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                            {group.items.map((row, i) => (
                                                <tr key={`${period}-${i}`} className="reports-row">
                                                    <td>
                                                        <div className="reports-row-name">{row.name || 'Unknown Item'}</div>
                                                        <div className="td-code reports-row-code">{row.barcode || ''}</div>
                                                    </td>
                                                    <td className="ta-center">{formatNumber(row.qtySold)}</td>
                                                    <td className="ta-center">
                                                        <span className="qty-badge">{formatNumber(row.currentStock)}</span>
                                                    </td>
                                                    <td className="ta-right reports-row-revenue">
                                                        Rs. {formatCurrency(row.revenue)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
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
