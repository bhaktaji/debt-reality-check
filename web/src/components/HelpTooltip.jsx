/**
 * web/src/components/HelpTooltip.jsx
 * The "What is this?" control that sits next to anything technical.
 *
 * Accessibility:
 *  - it is a real <button>, so it is keyboard reachable and announced as a button;
 *  - it carries an aria-label naming what it explains;
 *  - it sets aria-expanded and aria-controls;
 *  - Escape closes it, and clicking outside closes it;
 *  - the explanation is real text in the DOM, so a screen reader reads it in order.
 */

import { useEffect, useId, useRef, useState } from 'react';

export function HelpTooltip({ label, children, term, inline = false }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [open]);

  const text = children ?? label;

  return (
    <span className={`help${inline ? ' help-inline' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="help-btn"
        aria-label={term ? `What does ${term} mean?` : 'What does this mean?'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">{inline ? 'What is this?' : '?'}</span>
      </button>
      {open ? (
        <span className="help-pop" id={id} role="note">
          {text}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A label with an optional "?" beside it. Used by every field, so the help affordance is
 * consistent everywhere.
 */
export function FieldLabel({ htmlFor, children, help, term }) {
  return (
    <span className="label-row">
      <label htmlFor={htmlFor}>{children}</label>
      {help ? <HelpTooltip term={term ?? children}>{help}</HelpTooltip> : null}
    </span>
  );
}

export default HelpTooltip;
