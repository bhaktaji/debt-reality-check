/**
 * core/plain_language.js
 * Every user-facing word that translates the engine into something a person with no
 * finance background can read.
 *
 * This module is the single source of truth for:
 *  - what each tier is called in plain English, and what it means;
 *  - the one-line headline for each tier;
 *  - the glossary behind every "What is this?" tooltip;
 *  - the action lists shown on the result screen and in the report.
 *
 * It is shared by the dashboard, the HTML export and the bot, so the three can never
 * describe the same numbers differently.
 *
 * Tone rules (v2 F.3 / F-25): state facts and the next step. Candour about the numbers,
 * never about the person. The words "insolvent" and "prohibited" are banned and asserted
 * against by tests.
 *
 * Pure. No I/O.
 */

/* ------------------------------------------------------------------ *
 * Debt types, in the words people actually use
 * ------------------------------------------------------------------ */

/**
 * Friendly choices for the debt form. Each maps to the engine's vocabulary, so the user
 * never has to know what "revolving" or "installment" means. The mapping is shown in the
 * UI as secondary text, so nothing is hidden.
 */
export const DEBT_TYPE_CHOICES = Object.freeze([
  { id: 'credit_card', label: 'Credit card', type: 'revolving', help: 'A card you can spend on, repay, and spend on again.' },
  { id: 'personal_loan', label: 'Personal loan', type: 'installment', help: 'A fixed loan repaid in set monthly instalments.' },
  { id: 'bnpl', label: 'Buy now, pay later', type: 'bnpl', help: 'Short-term credit offered at checkout.' },
  { id: 'loan_app', label: 'Loan app', type: 'loanapp', help: 'A loan taken through a mobile app.' },
  { id: 'vehicle_loan', label: 'Vehicle loan', type: 'installment', help: 'A car or two-wheeler loan, usually tied to the vehicle.' },
  { id: 'other', label: 'Something else', type: 'installment', help: 'Anything else you repay in fixed monthly amounts.' },
]);

/** The engine type for a friendly choice id. Unknown ids fall back to a fixed instalment. */
export function engineTypeForChoice(choiceId) {
  return DEBT_TYPE_CHOICES.find((c) => c.id === choiceId)?.type ?? 'installment';
}

/** Best-effort reverse lookup, so a debt loaded from storage still shows a friendly label. */
export function choiceForEngineType(engineType) {
  const match = DEBT_TYPE_CHOICES.find((c) => c.type === engineType);
  return match ? match.id : 'other';
}

/* ------------------------------------------------------------------ *
 * Tiers, in plain English
 * ------------------------------------------------------------------ */

/**
 * `name`   short badge text
 * `says`   the sentence that opens the result ("You're in ...")
 * `means`  the plain-English explanation that immediately follows
 */
export const PLAIN_TIER = Object.freeze({
  1: Object.freeze({
    name: 'Comfortable',
    says: "You're in a comfortable position.",
    means: 'Your income covers your commitments and you have a buffer for surprises.',
  }),
  2: Object.freeze({
    name: 'Tight but manageable',
    says: "You're in a tight but manageable position.",
    means: 'You are covering your commitments, but there is not much margin if something goes wrong.',
  }),
  3: Object.freeze({
    name: 'Critical debt trap',
    says: "You're in the Critical Debt Trap range.",
    means: 'Your fixed obligations and current cash position leave relatively little room for unexpected problems.',
  }),
  4: Object.freeze({
    name: 'Cash-flow crisis',
    says: "You're in a cash-flow crisis.",
    means: 'Your monthly outgoings are bigger than your income, or your savings cannot cover the gap.',
  }),
});

/** The opening line of the result. Calm, honest, never alarmist. */
export const HEADLINES = Object.freeze({
  1: "You're in good shape. The main job now is keeping it that way.",
  2: "You're managing, but there isn't much margin for surprises.",
  3: 'Your finances are under pressure right now, but the numbers show a clear path forward.',
  4: 'Money is tight month to month. This needs attention now, and there are concrete steps to take.',
});

/* ------------------------------------------------------------------ *
 * Glossary - the text behind every "What is this?" tooltip
 * ------------------------------------------------------------------ */

/**
 * `term`  the technical name (shown as secondary detail)
 * `plain` the human name
 * `what`  a short, non-textbook explanation
 */
export const GLOSSARY = Object.freeze({
  foir: {
    term: 'FOIR',
    plain: 'How much of your income is already committed',
    what: 'How much of your monthly income is committed to fixed obligations such as rent and minimum debt payments.',
  },
  dcf: {
    term: 'Discretionary cash flow (DCF)',
    plain: 'Your monthly breathing room',
    what: 'How much money is left after essential expenses, rent and minimum debt payments.',
  },
  runway: {
    term: 'Emergency runway',
    plain: 'How long your savings would last',
    what: 'Roughly how many months your accessible savings could cover your current monthly outflow if your income stopped.',
  },
  interestBurn: {
    term: 'Interest burn',
    plain: 'Interest you pay each month',
    what: 'The money that goes on interest every month, before you reduce a single rupee of what you owe.',
  },
  debtLoad: {
    term: 'Debt-to-income months',
    plain: 'How many months of income you owe',
    what: 'How many months of your income it would take to clear everything you owe, before interest.',
  },
  creditUtilisation: {
    term: 'Credit utilisation',
    plain: 'How much of your credit you are using',
    what: 'How much of your available credit you are currently using. Using a large share of it can affect future borrowing.',
  },
  apr: {
    term: 'APR',
    plain: 'The yearly interest rate',
    what: 'The yearly interest rate charged by the lender. Some lenders quote rates differently, so we may convert them into a comparable figure.',
  },
  trueApr: {
    term: 'True APR',
    plain: 'What the loan really costs you',
    what: 'What the loan effectively costs you after considering the actual payments and upfront fees.',
  },
  avalanche: {
    term: 'Avalanche',
    plain: 'Highest-interest first',
    what: 'Pay the highest-interest debt first. This usually minimises total interest.',
  },
  snowball: {
    term: 'Snowball',
    plain: 'Smallest balance first',
    what: 'Pay the smallest debt first. This can give quicker psychological wins.',
  },
  minimumPayment: {
    term: 'Minimum payment',
    plain: 'The smallest payment your lender allows',
    what: 'The smallest amount you must pay each month. Paying only this usually takes a long time to clear a balance.',
  },
  essentials: {
    term: 'Essential spending',
    plain: 'The things you cannot skip',
    what: 'Food, medicine, electricity, transport and school fees. The things you need to keep the household running.',
  },
  reserves: {
    term: 'Liquid reserves',
    plain: 'Money you can reach quickly',
    what: 'Usually cash or savings you can access in a few days. Do not include long-term investments or money you cannot access easily.',
  },
  secured: {
    term: 'Secured debt',
    plain: 'A loan with something valuable tied to it',
    what: 'A loan where something valuable, such as a vehicle or property, is tied to it. If you do not repay, the lender can take that asset.',
  },
  revolving: {
    term: 'Revolving credit',
    plain: 'Credit you can reuse, like a card',
    what: 'Credit you can spend, repay and spend again, such as a credit card. The limit is the most you can borrow at any time.',
  },
  bnpl: {
    term: 'BNPL',
    plain: 'Buy now, pay later',
    what: 'Short-term credit offered at checkout, usually split into a few payments.',
  },
  loanApp: {
    term: 'Digital loan app',
    plain: 'A loan from a phone app',
    what: 'A loan taken through a mobile app. These often quote a daily or flat rate, which can be much more expensive than it first looks.',
  },
  tier: {
    term: 'Tier',
    plain: 'How your finances are rated overall',
    what: 'A simple four-level rating of how much pressure your finances are under, from comfortable through to a cash-flow crisis.',
  },
  negativeAmortisation: {
    term: 'Negative amortisation',
    plain: 'A balance that grows even when you pay',
    what: 'When the minimum payment is smaller than the interest charged that month, so what you owe goes up even though you paid on time.',
  },
  familyHelp: {
    term: 'Contingent support',
    plain: 'Money family could help with',
    what: 'Support that might be available but cannot be relied on. We show it for context and never count it as income.',
  },
});

/** Look up one glossary entry, with a safe fallback so a missing key never crashes a view. */
export function gloss(key) {
  return GLOSSARY[key] ?? { term: key, plain: key, what: '' };
}

/** All glossary entries, for the report appendix. */
export function glossaryList() {
  return Object.entries(GLOSSARY).map(([key, value]) => ({ key, ...value }));
}

/* ------------------------------------------------------------------ *
 * What I would do next - 3 to 5 short actions per tier
 * ------------------------------------------------------------------ */

export const ACTIONS_BY_TIER = Object.freeze({
  1: Object.freeze([
    { title: 'Keep building your buffer', body: 'Aim for six months of essential spending set aside. That is what turns a bad month into an inconvenience.' },
    { title: 'Pay extra on your highest-interest debt', body: 'Extra money goes furthest on the debt charging you the most.' },
    { title: 'Stay under 40% on fixed obligations', body: 'New borrowing is fine while rent and minimum payments stay below about 40% of your income.' },
  ]),
  2: Object.freeze([
    { title: 'Do not add new unsecured debt', body: 'Avoid new credit cards, buy-now-pay-later and loan apps while things are tight.' },
    { title: 'Prefer fixed pay over variable pay', body: 'If you change jobs, move to equal or higher fixed pay rather than commission-only work.' },
    { title: 'Build your buffer', body: 'Getting to three months of essentials would make a big difference to how safe you are.' },
    { title: 'Put extra money on the highest-interest debt', body: 'See the payoff plan below for what that saves you.' },
  ]),
  3: Object.freeze([
    { title: "Don't add new high-cost debt", body: 'No new credit lines, and avoid moving balances around between cards.' },
    { title: 'Protect your primary income', body: 'Avoid anything that makes your income less predictable while things are tight.' },
    { title: 'Put extra money on the highest-interest debt', body: 'At these rates, the order you repay in matters a lot.' },
    { title: 'Review discretionary spending for 30 days', body: 'Not the essentials - just the optional spending. The expense tracker can help.' },
    { title: 'Talk to your lenders if the shortfall continues', body: 'If your monthly breathing room stays under 10% of income, ask about hardship terms before you miss a payment.' },
  ]),
  4: Object.freeze([
    { title: 'Protect your income first', body: 'Keeping money coming in is the single most important thing this month.' },
    { title: 'Contact your lenders before you miss a payment', body: 'Lenders are far more willing to help before a payment is late than after.' },
    { title: 'Check every lending app you use', body: 'The RBI publishes a directory of digital lending apps run by regulated lenders. Check who you are dealing with.' },
    { title: 'Consider free credit counselling', body: 'Non-profit credit counselling services can help you negotiate without a fee. They do not sell you loans.' },
    { title: 'Keep records of any harassment', body: 'Save screenshots and call logs. There are official complaint routes, and we can point you to them.' },
  ]),
});

/* ------------------------------------------------------------------ *
 * The recommendation line per tier
 * ------------------------------------------------------------------ */

export const RECOMMENDATION_BY_TIER = Object.freeze({
  1: 'Keep doing what you are doing, build the buffer a little further, and put any spare money on the highest-interest debt.',
  2: 'For now, focus on not adding new unsecured debt, keeping your income steady, and building your buffer.',
  3: 'For now, focus on protecting your income, avoiding new unsecured debt, and putting extra money toward your highest-interest debt.',
  4: 'For now, focus on protecting your income and talking to your lenders before a payment is missed. Those two things buy you the most time.',
});

export default {
  PLAIN_TIER, HEADLINES, GLOSSARY, gloss, glossaryList,
  ACTIONS_BY_TIER, RECOMMENDATION_BY_TIER,
  DEBT_TYPE_CHOICES, engineTypeForChoice, choiceForEngineType,
};
