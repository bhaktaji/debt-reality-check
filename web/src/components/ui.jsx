/**
 * web/src/components/ui.jsx
 * The small set of primitives the redesigned UI needs.
 *
 * Accessibility rules live here so every screen inherits them: status always carries a
 * text label as well as a colour, and the disclosure is a real button with aria-expanded
 * rather than a colour change.
 */

import { useId, useState } from 'react';

/** A titled panel. Used sparingly - the result screen is mostly plain sections. */
export function Card({ title, children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </Tag>
  );
}

export function Note({ tone = '', children }) {
  return <p className={`note ${tone}`}>{children}</p>;
}

/** A short status chip. Always paired with words, never colour alone. */
export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

const TIER_SYMBOL = { 1: '●', 2: '◐', 3: '◔', 4: '○' };

export function TierBadge({ tier, label, showLabel = true }) {
  return (
    <span className={`badge tier${tier}`}>
      <span aria-hidden="true">{TIER_SYMBOL[tier] ?? '•'}</span>
      {`Tier ${tier}`}
      {showLabel && label ? ` - ${label}` : ''}
    </span>
  );
}

/** Collapsible block: a real button, aria-expanded, and no colour-only state. */
export function Disclosure({ summary, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="disclosure">
      <button type="button" className="disclosure-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {summary}
      </button>
      {open ? (
        <div id={id} className="disclosure-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default { Card, Note, Badge, TierBadge, Disclosure };
