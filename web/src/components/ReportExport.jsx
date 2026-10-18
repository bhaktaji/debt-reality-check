/**
 * web/src/components/ReportExport.jsx
 * "Download my report" plus the data controls.
 *
 * The download is a single self-contained HTML file built from the same report model the
 * on-screen view renders, so the two can never disagree. It needs no assets, works
 * offline, and prints cleanly to PDF from any browser.
 */

import { useRef, useState } from 'react';
import { toHtmlReport, toTextReport } from '@core/report.js';
import { exportJson, importJson } from '../storage.js';

export function ReportExport({ report, profile, expenses, audits, onImport, onErase, canExport }) {
  const [message, setMessage] = useState(null);
  const fileRef = useRef(null);
  const stamp = new Date().toISOString().slice(0, 10);

  const download = (filename, content, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onHtml = () => {
    if (!report) return setMessage('Complete the audit first.');
    download(`debt-reality-check-${stamp}.html`, toHtmlReport(report), 'text/html');
    setMessage('Report downloaded. Open it and use Print → Save as PDF if you want a PDF.');
    return undefined;
  };

  const onPrint = () => {
    if (!report) return setMessage('Complete the audit first.');
    const win = window.open('', '_blank');
    if (!win) return setMessage('Your browser blocked the print window.');
    win.document.write(toHtmlReport(report));
    win.document.close();
    win.focus();
    return undefined;
  };

  const onText = async () => {
    if (!report) return setMessage('Complete the audit first.');
    const text = toTextReport(report);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Report copied to the clipboard.');
    } catch {
      download(`debt-reality-check-${stamp}.txt`, text, 'text/plain');
      setMessage('Clipboard unavailable, so the report was downloaded instead.');
    }
    return undefined;
  };

  const onBackup = () => {
    download(`debt-reality-backup-${stamp}.json`, exportJson({ profile, expenses, audits }), 'application/json');
    setMessage('Backup downloaded. It contains your numbers only, no identifiers.');
  };

  const onRestore = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const state = importJson(String(reader.result));
      if (!state) return setMessage('That file could not be read.');
      onImport(state);
      setMessage('Backup restored.');
      return undefined;
    };
    reader.readAsText(file);
    event.target.value = '';
    return undefined;
  };

  return (
    <section className="block" aria-labelledby="export-heading">
      <h2 id="export-heading">Keep a copy</h2>
      <p className="tiny muted">
        The report is a single file. It opens anywhere, works offline, and prints cleanly.
      </p>

      <div className="button-row">
        <button type="button" className="primary" onClick={onHtml} disabled={!canExport}>
          Download my report
        </button>
        <button type="button" onClick={onPrint} disabled={!canExport}>
          Print or save as PDF
        </button>
        <button type="button" onClick={onText} disabled={!canExport}>
          Copy as text
        </button>
      </div>

      {message ? (
        <p className="note good" role="status">
          {message}
        </p>
      ) : null}

      <details className="data-controls">
        <summary>Backup and erasure</summary>
        <div className="button-row">
          <button type="button" onClick={onBackup}>
            Download JSON backup
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            Restore from backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={onRestore}
            aria-label="Restore from a JSON backup file"
          />
        </div>
        <p className="tiny muted">
          Everything on this page lives in this browser on this device. There is no account, no server call and
          no analytics.
        </p>
        <div className="button-row">
          <button type="button" className="danger" onClick={onErase}>
            DELETE MY DATA
          </button>
        </div>
        <p className="tiny muted">
          This erases the profile, expense log and audit history from this browser immediately. It cannot be
          undone.
        </p>
      </details>
    </section>
  );
}

export default ReportExport;
