/**
 * web/src/components/MoneyField.jsx
 * A forgiving money input.
 *
 * Accepts whatever people actually type - "₹60,000", "60000", "60k", "1.5 lakh" - through
 * the SAME strict parser the bot uses, and then echoes it back in words so a 10x slip is
 * obvious ("You entered ₹60,000 per month. Is that correct?").
 *
 * When a message contains more than one amount, it asks a plain question instead of
 * dumping a parser error.
 */

import { useEffect, useRef, useState } from 'react';
import { parseSingleAmount } from '@core/input.js';
import { inr } from '@core/formatting.js';
import { FieldLabel } from './HelpTooltip.jsx';

export function MoneyField({
  id,
  label,
  value,
  onChange,
  help,
  term,
  cadence = 'per month',
  placeholder = 'e.g. 60000 or 1.5 lakh',
  hint,
  required = false,
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const lastEmitted = useRef(value);

  // Only re-sync from the parent when the change did not come from this input.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value === null || value === undefined ? '' : String(value));
      lastEmitted.current = value;
    }
  }, [value]);

  const commit = (raw) => {
    setText(raw);
    if (raw.trim() === '') {
      setError(null);
      lastEmitted.current = null;
      onChange(null);
      return;
    }
    const parsed = parseSingleAmount(raw);
    if (!parsed.ok) {
      setError(
        parsed.error === 'AMBIGUOUS_AMOUNT'
          ? 'I found more than one amount there. Which one should I use?'
          : "I couldn't read that as an amount. Try 60000, 60k or 1.5 lakh.",
      );
      return;
    }
    setError(null);
    lastEmitted.current = parsed.value;
    onChange(parsed.value);
  };

  const confirmed = !error && value !== null && value !== undefined && value !== '';
  const hintId = hint ? `${id}-hint` : undefined;
  const echoId = `${id}-echo`;
  const errId = `${id}-error`;
  const describedBy = [hintId, error ? errId : echoId].filter(Boolean).join(' ');

  return (
    <div className="field">
      <FieldLabel htmlFor={id} help={help} term={term}>
        {label}
        {required ? <span className="req" aria-hidden="true"> *</span> : null}
      </FieldLabel>

      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        aria-required={required}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => commit(text)}
      />

      {hint ? <span className="hint" id={hintId}>{hint}</span> : null}

      {error ? (
        <span className="error" id={errId} role="alert">{error}</span>
      ) : confirmed ? (
        <span className="echo" id={echoId} aria-live="polite">
          <span aria-hidden="true">✓</span> You entered <strong>{inr(value)}</strong>
          {cadence ? ` ${cadence}` : ''}. Is that correct?
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setText('');
              setError(null);
              lastEmitted.current = null;
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            Change
          </button>
        </span>
      ) : null}
    </div>
  );
}

export default MoneyField;
