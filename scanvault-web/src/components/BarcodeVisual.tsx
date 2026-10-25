'use client';

import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface BarcodeVisualProps {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

export default function BarcodeVisual({
  value,
  width = 2,
  height = 50,
  fontSize = 13,
  displayValue = true,
  className = '',
}: BarcodeVisualProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value || !value.trim()) return;

    try {
      JsBarcode(svgRef.current, value.trim(), {
        format: 'CODE128',
        lineColor: '#000000',
        background: '#ffffff',
        width,
        height,
        displayValue,
        fontSize,
        margin: 6,
        textMargin: 3,
      });
    } catch {
      // In case of unsupported characters in custom barcode, fallback gracefully
      try {
        JsBarcode(svgRef.current, value.replace(/[^a-zA-Z0-9]/g, '') || '000000000000', {
          format: 'CODE128',
          width,
          height,
          displayValue,
        });
      } catch {
        /* ignore invalid input */
      }
    }
  }, [value, width, height, fontSize, displayValue]);

  if (!value || !value.trim()) {
    return <div className="text-gray-500 text-xs italic py-2">No barcode provided</div>;
  }

  return (
    <div className={`inline-block bg-white p-2 rounded-lg shadow-inner ${className}`}>
      <svg ref={svgRef} className="max-w-full block mx-auto" />
    </div>
  );
}

/**
 * Print barcode labels alone with product name and price, matching legacy Electron app.
 */
export function printBarcodeLabels({
  barcode,
  name,
  price,
  copies = 1,
  size = 'medium',
}: {
  barcode: string;
  name: string;
  price: number;
  copies?: number;
  size?: 'small' | 'medium' | 'large';
}) {
  if (typeof window === 'undefined') return;

  const sizes = {
    small: { w: '35mm', h: '22mm', barW: 1.2, barH: 30, font: 9 },
    medium: { w: '55mm', h: '35mm', barW: 1.8, barH: 45, font: 11 },
    large: { w: '75mm', h: '48mm', barW: 2.2, barH: 60, font: 13 },
  };

  const currentSize = sizes[size] || sizes.medium;

  // Create temporary container to generate SVG markup with JsBarcode
  const tempSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tempSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  try {
    JsBarcode(tempSvg, barcode.trim(), {
      format: 'CODE128',
      lineColor: '#000',
      background: '#fff',
      width: currentSize.barW,
      height: currentSize.barH,
      displayValue: true,
      fontSize: currentSize.font,
      margin: 4,
    });
  } catch {
    /* fallback */
  }

  const svgHtml = typeof XMLSerializer !== 'undefined'
    ? new XMLSerializer().serializeToString(tempSvg)
    : tempSvg.outerHTML;

  const fmtPrice = (price || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const labelCards: string[] = [];
  for (let i = 0; i < copies; i++) {
    labelCards.push(`
      <div class="label-card">
        ${name ? `<div class="pname">${name}</div>` : ''}
        <div class="barcode-wrap">${svgHtml}</div>
        <div class="pprice">Rs. ${fmtPrice}</div>
      </div>
    `);
  }

  const printWin = window.open('', '_blank', 'width=650,height=550');
  if (!printWin) return;

  printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Barcode Label - ${barcode}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page {
      margin: 3mm;
      size: auto;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 4mm;
      background: #fff;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .labels-container {
      display: flex;
      flex-wrap: wrap;
      gap: 4mm;
      justify-content: flex-start;
      align-items: flex-start;
    }
    .label-card {
      width: ${currentSize.w};
      min-height: ${currentSize.h};
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px dashed #bbb;
      padding: 3mm 2mm;
      page-break-inside: avoid;
      background: #fff;
      text-align: center;
    }
    .pname {
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 2px;
      text-transform: uppercase;
    }
    .barcode-wrap {
      width: 100%;
      display: flex;
      justify-content: center;
    }
    .barcode-wrap svg {
      max-width: 100%;
      height: auto;
      display: block;
    }
    .pprice {
      font-size: 11px;
      font-weight: 800;
      color: #000;
      margin-top: 2px;
      font-family: monospace;
    }
    @media print {
      body { padding: 0; }
      .label-card { border: none; }
    }
  </style>
</head>
<body>
  <div class="labels-container">
    ${labelCards.join('')}
  </div>
  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
        window.close();
      }, 250);
    };
  </script>
</body>
</html>`);
  printWin.document.close();
}
