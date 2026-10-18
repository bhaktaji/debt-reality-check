/**
 * web/src/components/AuditHistory.jsx
 * Previous audits and how the position moved, in the same plain language as everywhere else.
 */

import { Card, TierBadge } from './ui.jsx';
import { PLAIN_TIER } from '@core/plain_language.js';
import { inr, pct, months as fmtMonths } from '@core/formatting.js';

export function AuditHistory({ audits, onSave, canSave, onClear }) {
  return (
    <Card title="Your progress over time">
      <p className="tiny muted">
        Saving an audit keeps a snapshot, so you can see whether things are moving in the right direction.
      </p>

      <div className="button-row">
        <button type="button" className="primary" onClick={onSave} disabled={!canSave}>
          Save this audit
        </button>
        {audits.length ? (
          <button type="button" className="ghost" onClick={onClear}>
            Clear history
          </button>
        ) : null}
      </div>

      {!audits.length ? (
        <p className="tiny muted">No saved audits yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Saved audits, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Position</th>
                <th scope="col" className="num">Monthly room</th>
                <th scope="col" className="num">Buffer</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a, i) => {
                const prev = audits[i + 1];
                const change = prev ? a.tier - prev.tier : 0;
                return (
                  <tr key={a.id}>
                    <td className="tiny">{new Date(a.takenAt).toLocaleString('en-IN')}</td>
                    <td>
                      <TierBadge tier={a.tier} label={PLAIN_TIER[a.tier]?.name} />
                      <div className="tiny muted">
                        {!prev
                          ? 'first audit'
                          : change === 0
                            ? 'no change'
                            : change < 0
                              ? `improved from ${PLAIN_TIER[prev.tier]?.name}`
                              : `moved back to ${PLAIN_TIER[a.tier]?.name}`}
                      </div>
                    </td>
                    <td className="num">{inr(a.dcf)}</td>
                    <td className="num">{a.runway === null ? 'n/a' : fmtMonths(a.runway)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {audits.length ? (
        <p className="tiny muted">Latest fixed-obligation share of income: {pct(audits[0].foir)}.</p>
      ) : null}
    </Card>
  );
}

export default AuditHistory;
