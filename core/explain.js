/**
 * core/explain.js
 * Turns each engine metric into a plain-language sentence, using the user's own numbers.
 *
 * The dashboard's "See the numbers" section and the report's technical section are both
 * built from this one function, so a number can never be explained two different ways.
 *
 * Nothing here changes a calculation. It only describes values the engine already produced.
 * Pure. No I/O.
 */

import { inr, pct, humanMonths } from './formatting.js';

/**
 * @param {object} diagnostic a successful runDiagnosticV2 result
 * @returns {Array<{key:string, plainLabel:string, technicalLabel:string, value:string,
 *                  meaning:string, available:boolean, why?:string}>}
 */
export function explainedMetrics(diagnostic) {
  const m = diagnostic.metrics;
  const out = [];

  /* How much of income is committed ------------------------------------ */
  const rupeesPerHundred = Math.round(m.foir);
  out.push({
    key: 'foir',
    plainLabel: 'How much of your income is already committed',
    technicalLabel: 'FOIR (fixed obligations to income)',
    value: pct(m.foir),
    available: true,
    meaning:
      `About ₹${rupeesPerHundred} of every ₹100 of your monthly income is committed to rent and minimum debt payments. ` +
      (m.foir >= 65
        ? 'That is a very large share.'
        : m.foir >= 50
          ? 'That is a large share.'
          : m.foir >= 40
            ? 'That is a fairly high share.'
            : 'That is a manageable share.'),
  });

  /* Monthly breathing room --------------------------------------------- */
  out.push({
    key: 'dcf',
    plainLabel: 'Your monthly breathing room',
    technicalLabel: 'DCF (discretionary cash flow)',
    value: `${inr(m.dcf)}/month`,
    available: true,
    meaning:
      m.dcf >= 0
        ? `This is what is left each month after essentials, housing and minimum debt payments. It is about ${pct(m.dcfPct)} of your income.`
        : `Your essentials, housing and minimum debt payments come to about ${inr(Math.abs(m.dcf))} more than your income each month.`,
  });

  /* Savings buffer ------------------------------------------------------ */
  if (Number.isFinite(m.er)) {
    const phrase = humanMonths(m.er);
    out.push({
      key: 'runway',
      plainLabel: 'How long your savings would last',
      technicalLabel: 'Emergency runway',
      value: phrase.charAt(0).toUpperCase() + phrase.slice(1),
      available: true,
      meaning:
        `If your income stopped tomorrow, the money you can reach quickly would cover ${phrase} of your current monthly spending. ` +
        (m.er >= 6 ? 'That is a solid buffer.' : m.er >= 3 ? 'That gives you some time, but not much.' : m.er >= 1 ? 'That is thin.' : 'That is very thin.'),
    });
  } else {
    out.push({
      key: 'runway',
      plainLabel: 'How long your savings would last',
      technicalLabel: 'Emergency runway',
      value: 'Not applicable',
      available: false,
      why: 'You have no monthly outflow recorded, so there is nothing for a buffer to cover.',
      meaning: '',
    });
  }

  /* Interest ------------------------------------------------------------ */
  out.push({
    key: 'interestBurn',
    plainLabel: 'Interest you pay each month',
    technicalLabel: 'Interest burn',
    value: `${inr(m.interestBurn)}/month`,
    available: true,
    meaning: m.interestBurn > 0
      ? `This much goes on interest every month before you reduce anything you owe. Over a year that is roughly ${inr(m.interestBurn * 12)}.`
      : 'None of your debts are charging interest, or no rates were provided.',
  });

  /* Debt load ----------------------------------------------------------- */
  out.push({
    key: 'debtLoad',
    plainLabel: 'How many months of income you owe',
    technicalLabel: 'Debt-to-income months',
    value: `${m.dtiMonths.toFixed(1)} months`,
    available: true,
    meaning: `You owe about ${inr(m.totalBalance)} in total. That is roughly ${m.dtiMonths.toFixed(1)} months of your income, before interest.`,
  });

  /* Credit utilisation -------------------------------------------------- */
  if (m.cur === null) {
    out.push({
      key: 'creditUtilisation',
      plainLabel: 'How much of your credit you are using',
      technicalLabel: 'Credit utilisation',
      value: 'Unknown',
      available: false,
      why: 'You did not provide a credit limit, so we will not guess it.',
      meaning: '',
    });
  } else {
    out.push({
      key: 'creditUtilisation',
      plainLabel: 'How much of your credit you are using',
      technicalLabel: 'Credit utilisation',
      value: pct(m.cur),
      available: true,
      meaning:
        `You are using about ${pct(m.cur)} of the credit limit you gave us. ` +
        (m.cur > 70
          ? 'That is a high level of use, and lenders tend to treat it as a warning sign.'
          : m.cur > 30
            ? 'That is above the level lenders usually like to see.'
            : 'That is within the range lenders usually like to see.'),
    });
  }

  /* Unsecured lines ----------------------------------------------------- */
  out.push({
    key: 'unsecuredLines',
    plainLabel: 'Unsecured debts you are paying',
    technicalLabel: 'Unsecured lines with a balance',
    value: String(m.unsecuredLines),
    available: true,
    meaning: m.unsecuredLines >= 3
      ? 'You are managing three or more unsecured debts at once. Lenders read that as a sign of pressure.'
      : m.unsecuredLines === 0
        ? 'You have no unsecured debts with a balance.'
        : `You have ${m.unsecuredLines} unsecured ${m.unsecuredLines === 1 ? 'debt' : 'debts'} with a balance.`,
  });

  /* Time to default ----------------------------------------------------- */
  if (m.dcf < 0) {
    const phrase = Number.isFinite(m.monthsToDefault) ? humanMonths(m.monthsToDefault) : null;
    out.push({
      key: 'monthsToDefault',
      plainLabel: 'How long your savings hold out',
      technicalLabel: 'Months to default at the current shortfall',
      value: phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : 'Already short',
      available: true,
      meaning: phrase && m.monthsToDefault >= 1
        ? `At the current shortfall, your accessible savings would cover roughly ${phrase} of payments before money runs out.`
        : 'There is no accessible savings buffer to cover the shortfall.',
    });
  }

  return out;
}

export default { explainedMetrics };
