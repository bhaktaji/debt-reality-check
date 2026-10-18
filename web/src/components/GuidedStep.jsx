/**
 * web/src/components/GuidedStep.jsx
 * One screen of the guided flow: where you are, what is being asked, and what to do next.
 *
 * The progress list is a real ordered list with aria-current, so a screen reader can tell
 * which step is active without relying on colour.
 */

export function GuidedStep({
  stepIndex,
  steps,
  title,
  blurb,
  children,
  onBack,
  onNext,
  nextLabel = 'Continue',
  canContinue = true,
  footnote,
}) {
  const total = steps.length;
  const current = stepIndex + 1;

  return (
    <section className="step" aria-labelledby="step-title">
      <ol className="progress" aria-label={`Step ${current} of ${total}`}>
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={i === stepIndex ? 'is-current' : i < stepIndex ? 'is-done' : ''}
            aria-current={i === stepIndex ? 'step' : undefined}
          >
            <span className="dot" aria-hidden="true">{i < stepIndex ? '✓' : i + 1}</span>
            <span className="sr-only">
              {i < stepIndex ? 'Completed: ' : i === stepIndex ? 'Current step: ' : 'Upcoming: '}
            </span>
            <span className="progress-label">{s.short}</span>
          </li>
        ))}
      </ol>

      <p className="step-count">
        Step {current} of {total}
      </p>
      <h2 id="step-title">{title}</h2>
      {blurb ? <p className="blurb">{blurb}</p> : null}

      <div className="step-body">{children}</div>

      <div className="step-nav">
        {onBack ? (
          <button type="button" className="ghost" onClick={onBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="primary big" onClick={onNext} disabled={!canContinue}>
          {nextLabel}
        </button>
      </div>

      {footnote ? <p className="tiny muted">{footnote}</p> : null}
    </section>
  );
}

export default GuidedStep;
