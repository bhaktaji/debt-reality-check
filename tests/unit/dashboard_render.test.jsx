import { describe, it, expect, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import App from '../../web/src/App.jsx';
import { ARCHETYPE_BY_ID } from '../fixtures/archetypes.js';
import { diagnoseProfile } from '../../core/profile.js';

/**
 * Dashboard render smoke tests.
 *
 * The real React tree is rendered to a string in Node - no browser, no jsdom - so every
 * screen of the redesigned flow is exercised on each CI run: the welcome, each guided
 * step, the conversational result, the full report tab, and the accessibility contract.
 *
 * `norm()` strips the comment markers React inserts between adjacent text nodes and
 * decodes the HTML entities React escapes, so assertions can match the sentence a reader
 * actually sees.
 */

const norm = (html) =>
  html
    .replace(/<!--\s*-->/g, '')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function seedLocalStorage(state) {
  const store = new Map([['drc.dashboard.v2', JSON.stringify(state)]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
}

function render(overrides = {}) {
  seedLocalStorage({
    consent: true,
    step: 'income',
    profile: null,
    expenses: [],
    audits: [],
    ...overrides,
  });
  return norm(renderToString(<App />));
}

afterEach(() => {
  delete globalThis.localStorage;
});

/* ------------------------------------------------------------------ *
 * Welcome
 * ------------------------------------------------------------------ */

describe('the welcome screen', () => {
  it('explains what the tool wants in plain language', () => {
    seedLocalStorage({ consent: false, profile: null, expenses: [], audits: [] });
    const html = norm(renderToString(<App />));
    expect(html).toContain('understand where you stand financially');
    expect(html).toContain('You don’t need to know any finance terms');
    expect(html).toContain('Get started');
    expect(html).toContain('Show me an example first');
  });

  it('states the privacy position and the disclaimer before anything is entered', () => {
    seedLocalStorage({ consent: false, profile: null, expenses: [], audits: [] });
    const html = norm(renderToString(<App />));
    expect(html).toContain('What happens to what I type?');
    expect(html).toContain('not legal, tax or investment advice');
    expect(html).toContain('No account, no sign-up, nothing sent anywhere');
  });

  it('never uses forbidden language', () => {
    seedLocalStorage({ consent: false, profile: null, expenses: [], audits: [] });
    const html = norm(renderToString(<App />));
    expect(html).not.toMatch(/insolven/i);
    expect(html).not.toMatch(/prohibit/i);
  });
});

/* ------------------------------------------------------------------ *
 * Guided steps
 * ------------------------------------------------------------------ */

const SAMPLE_DEBT = {
  id: 'd1',
  name: 'HDFC credit card',
  choice: 'credit_card',
  type: 'revolving',
  secured: false,
  balance: 65000,
  minPayment: 3500,
  apr: 42,
  creditLimit: 100000,
};

describe('the guided audit', () => {
  it('shows where you are and asks one thing at a time', () => {
    const html = render();
    expect(html).toContain('Step 1 of 5');
    expect(html).toContain('Your income');
    expect(html).toContain('How much money comes into your household each month, after tax?');
    expect(html).toContain('Continue');
  });

  it('asks whether income is stable, and offers the history only when it is not', () => {
    const stable = render({ step: 'income', profile: { netIncome: 60000, incomeStable: true } });
    expect(stable).toContain('Is your monthly income roughly the same every month?');
    expect(stable).not.toContain('Tell us your recent monthly income');

    const unstable = render({ step: 'income', profile: { netIncome: 60000, incomeStable: false, incomeHistory: [50000] } });
    expect(unstable).toContain('Tell us your recent monthly income');
    expect(unstable).toContain('a good month cannot hide a bad one');
  });

  it('uses plain-English labels for costs and makes the rent/EMI split explicit', () => {
    const html = render({ step: 'costs', profile: { netIncome: 60000 } });
    expect(html).toContain('Monthly rent or housing payment');
    expect(html).toContain('About how much do you spend each month on essentials?');
    expect(html).toContain('Rent and loan payments are counted separately');
  });

  it('explains the safety-net question without jargon', () => {
    const html = render({ step: 'buffer', profile: { netIncome: 60000 } });
    expect(html).toContain('How much money could you use right now if your income stopped?');
    expect(html).toContain('Do not include long-term investments');
  });

  it('asks who earns and who depends, in plain words', () => {
    const html = render({ step: 'household', profile: { netIncome: 60000 } });
    expect(html).toContain('How many people currently earn money in the household?');
    expect(html).toContain('How many people depend financially on this household income?');
    expect(html).toContain('Could family help you out financially if you needed it?');
    expect(html).toContain('never counted as income');
  });

  it('enters debts as cards, not a table', () => {
    const html = render({ step: 'debts', profile: { netIncome: 60000, debts: [SAMPLE_DEBT] } });
    expect(html).toContain('What would you like to call it?');
    expect(html).toContain('What kind of debt is it?');
    expect(html).toContain('Is something valuable tied to this loan');
    expect(html).toContain('How much do you still owe?');
    expect(html).toContain('What is the minimum payment each month?');
    expect(html).toContain('What interest rate does it charge?');
    // A credit card is asked for its limit, and "I don't know" is offered honestly.
    expect(html).toContain('What is your credit limit?');
    expect(html).toContain('I don’t know');
    expect(html).toContain('Add another debt');
    // No database-like debt table in the primary flow.
    expect(html).not.toContain('<table');
  });

  it('does not ask for a credit limit on a fixed instalment loan', () => {
    const html = render({
      step: 'debts',
      profile: {
        netIncome: 60000,
        debts: [{ id: 'd1', name: 'Car loan', choice: 'vehicle_loan', type: 'installment', secured: true, balance: 300000, minPayment: 9000, apr: 11 }],
      },
    });
    expect(html).not.toContain('What is your credit limit?');
  });

  it('shows the friendly type choices rather than the engine vocabulary', () => {
    const html = render({ step: 'debts', profile: { netIncome: 60000, debts: [SAMPLE_DEBT] } });
    for (const label of ['Credit card', 'Personal loan', 'Buy now, pay later', 'Loan app', 'Vehicle loan', 'Something else']) {
      expect(html, label).toContain(label);
    }
    // The engine's word for it is present only as small secondary text.
    expect(html).toContain('we record this as revolving');
  });

  it('warns when a balance grows even when paid on time', () => {
    const html = render({
      step: 'debts',
      profile: {
        netIncome: 60000,
        debts: [{ id: 'd1', name: 'Card', choice: 'credit_card', type: 'revolving', secured: false, balance: 100000, minPayment: 3000, apr: 48, creditLimit: 200000 }],
      },
    });
    expect(html).toContain('This balance grows even when you pay on time');
  });
});

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

describe('the result screen', () => {
  const full = {
    step: 'result',
    resultTab: 'summary',
    profile: ARCHETYPE_BY_ID.B.profile,
    expenses: [{ id: 'e1', amount: 1500, category: 'Utilities', isEssential: true, description: 'electricity', createdAt: new Date().toISOString() }],
    audits: [{ id: 'a1', takenAt: new Date().toISOString(), tier: 4, foir: 60, dcf: -5000, runway: 0.2, debt: 400000, interestBurn: 30000 }],
  };

  it('opens with a human verdict, not a metric table', () => {
    const html = render(full);
    const verdictAt = html.indexOf("You're in the");
    const metricAt = html.indexOf('FOIR');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(metricAt).toBeGreaterThan(-1);
    // The plain verdict comes before any technical metric name appears.
    expect(verdictAt).toBeLessThan(metricAt);
  });

  it('contains a plain explanation, the pressure points and next actions', () => {
    const html = render(full);
    expect(html).toContain('Here’s what I found');
    expect(html).toContain('What this means');
    expect(html).toContain('Your biggest pressure points');
    expect(html).toContain('What I would focus on next');
  });

  it('shows the payoff plan as two plain options', () => {
    const html = render(full);
    expect(html).toContain('Your debt payoff plan');
    expect(html).toContain('Highest-interest first');
    expect(html).toContain('Smallest balance first');
    // The technical names survive only as secondary labels.
    expect(html).toContain('Also called Avalanche');
    expect(html).toContain('Also called Snowball');
  });

  it('keeps the numbers visible and the calculation details behind a disclosure', () => {
    const html = render(full);
    expect(html).toContain('Your numbers');
    expect(html).toContain('Each figure is followed by what it actually means for you');
    expect(html).toContain('How we calculated this');
    expect(html).toContain('Show the full calculation details');
    // Closed by default, so the appendix is not rendered until asked for.
    expect(html).not.toContain('Effective monthly income');
  });

  it('offers a full report tab that renders the same document', () => {
    const html = render({ ...full, resultTab: 'report' });
    expect(html).toContain('My full report');
    expect(html).toContain('Your Debt Reality Check');
    expect(html).toContain('Assumptions and limitations');
    expect(html).toContain('Show the full calculation details');
  });

  it('offers the report download and the erasure control', () => {
    const html = render(full);
    expect(html).toContain('Download my report');
    expect(html).toContain('Print or save as PDF');
    expect(html).toContain('DELETE MY DATA');
  });

  it('offers the expense tracker in plain language', () => {
    const html = render(full);
    expect(html).toContain('Did you spend anything today?');
  });

  it('matches the verdict the engine produced', () => {
    const html = render(full);
    const expected = diagnoseProfile(ARCHETYPE_BY_ID.B.profile);
    expect(html).toContain(`tier ${expected.tier} of 4`);
    expect(html).toContain(expected.tierLabel);
  });

  it('asks for an income instead of rendering a broken result', () => {
    const html = render({ step: 'result', profile: { netIncome: null, debts: [] } });
    expect(html).toContain('Almost there');
    expect(html).toContain('Go back and add your income');
  });
});

/* ------------------------------------------------------------------ *
 * Accessibility and mobile
 * ------------------------------------------------------------------ */

describe('accessibility and mobile structure', () => {
  it('binds every label to a control that exists', () => {
    const screens = {
      income: { step: 'income', profile: { netIncome: 60000 } },
      costs: { step: 'costs', profile: { netIncome: 60000 } },
      buffer: { step: 'buffer', profile: { netIncome: 60000 } },
      household: { step: 'household', profile: { netIncome: 60000 } },
      debts: { step: 'debts', profile: { netIncome: 60000, debts: [SAMPLE_DEBT] } },
    };
    for (const [name, override] of Object.entries(screens)) {
      const html = render(override);
      const fors = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1]);
      expect(fors.length, name).toBeGreaterThan(0);
      for (const id of fors) {
        expect(html, `${name}: label for="${id}" has no matching control`).toContain(`id="${id}"`);
      }
    }
  });

  it('gives every technical field a "what does this mean?" control', () => {
    const html = render({ step: 'costs', profile: { netIncome: 60000 } });
    expect(html).toContain('aria-label="What does');
    expect(html).toContain('aria-expanded="false"');
  });

  it('marks the active step for screen readers rather than by colour alone', () => {
    const html = render({ step: 'buffer', profile: { netIncome: 60000 } });
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Current step:');
    expect(html).toContain('Completed:');
  });

  it('offers a skip link on the result screen', () => {
    const html = render({ step: 'result', resultTab: 'summary', profile: ARCHETYPE_BY_ID.C.profile });
    expect(html).toContain('Skip to the result');
  });

  it('uses a responsive layout rather than hard-coded widths', () => {
    const html = render({ step: 'debts', profile: { netIncome: 60000, debts: [SAMPLE_DEBT] } });
    expect(html).not.toMatch(/style="[^"]*width:\s*\d{3,}px/);
    expect(html).not.toMatch(/style="[^"]*min-width:\s*\d{3,}px/);
  });

  it('pairs every status colour with words', () => {
    const html = render({ step: 'result', resultTab: 'summary', profile: ARCHETYPE_BY_ID.D.profile });
    // The tier is stated in words, twice: the plain verdict and the technical rating.
    expect(html).toMatch(/tier \d of 4/i);
    expect(html.toLowerCase()).toContain('cash-flow crisis');
  });

  it('never uses forbidden language on any screen', () => {
    const screens = [
      render({ step: 'income', profile: { netIncome: 60000 } }),
      render({ step: 'debts', profile: { netIncome: 60000, debts: [SAMPLE_DEBT] } }),
      render({ step: 'result', resultTab: 'summary', profile: ARCHETYPE_BY_ID.D.profile }),
      render({ step: 'result', resultTab: 'report', profile: ARCHETYPE_BY_ID.D.profile }),
    ];
    for (const html of screens) {
      expect(html).not.toMatch(/insolven/i);
      expect(html).not.toMatch(/prohibit/i);
    }
  });
});
