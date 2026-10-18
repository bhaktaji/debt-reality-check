/**
 * core/narrative.js
 * Turns a diagnostic into a calm, human explanation of the user's situation.
 *
 * This is the text a person actually reads. It is deliberately free of finance jargon:
 * the technical names live in core/explain.js (the numbers section) and in the report
 * appendix, both of which the reader has to open on purpose.
 *
 * Shared by the dashboard, the HTML export and the bot, so the same numbers are never
 * described two different ways.
 *
 * Pure. No I/O.
 */

import { PLAIN_TIER, HEADLINES, ACTIONS_BY_TIER, RECOMMENDATION_BY_TIER } from './plain_language.js';
import { inr, pct, aboutMonths } from './formatting.js';

/** How the monthly surplus or shortfall reads. */
function breathingRoom(dcf, dcfPct) {
  if (dcf < 0) {
    return 'That means your monthly outgoings are bigger than what comes in.';
  }
  if (dcfPct >= 25) return 'That is a healthy amount of breathing room.';
  if (dcfPct >= 10) return 'That is workable breathing room, but not a large one.';
  return 'That is a small amount of breathing room.';
}

/** How the savings buffer reads. */
function bufferSentence(er) {
  if (!Number.isFinite(er)) return 'You have no monthly outflow recorded, so there is nothing for a buffer to cover.';
  if (er >= 6) return 'That is a solid buffer, and it is doing real work for you.';
  if (er >= 3) return 'That gives you some time, but not much.';
  if (er >= 1) return 'That is thin. One unexpected bill would eat most of it.';
  return 'That is very thin.';
}

/** The plain-language alternative routes, without any metric names. */
function alternativeRoutes(distance) {
  return distance.options.slice(1).map((o) => {
    switch (o.metric) {
      case 'FOIR':
        return `Another route: reduce your fixed monthly payments by ${inr(o.amount)}.`;
      case 'DCF':
        return `Another route: find ${inr(o.amount)} more of monthly breathing room.`;
      case 'Runway':
        return `Another route: add ${inr(o.amount)} to the money you can reach quickly.`;
      default:
        return `Another route: ${o.label.toLowerCase()}.`;
    }
  });
}

/** The single most useful next change, in plain words (from the engine's distance block). */
function improvementSentences(distance) {
  if (!distance?.applicable || !distance.best) {
    return { applicable: false, sentences: [], best: null };
  }
  const best = distance.best;
  let sentence;
  switch (best.metric) {
    case 'FOIR':
      sentence = `Reducing your fixed monthly payments by about ${inr(best.amount)} would move this into the next healthier range.`;
      break;
    case 'DCF':
      sentence = `Finding about ${inr(best.amount)} more of monthly breathing room would move this into the next healthier range.`;
      break;
    case 'Runway':
      sentence = `Adding about ${inr(best.amount)} to the money you can reach quickly would materially improve your buffer.`;
      break;
    default:
      sentence = `${best.label}.`;
  }
  return {
    applicable: true,
    best,
    sentences: [sentence, ...alternativeRoutes(distance)],
  };
}

/** The biggest pressure points, most severe first, capped so the screen stays readable. */
function pressurePoints(d) {
  const m = d.metrics;
  const points = [];

  if (m.dcf < 0) {
    points.push({
      rank: 0,
      title: 'You are spending more than you bring in',
      body: `Each month your commitments come to about ${inr(Math.abs(m.dcf))} more than your income.`,
    });
  }
  if (d.tiers.foir >= 3) {
    points.push({
      rank: 1,
      title: 'Your fixed payments take a large share of your income',
      body: `About ₹${Math.round(m.foir)} of every ₹100 you bring in is already committed to rent and minimum debt payments.`,
    });
  }
  if (d.tiers.runway >= 3) {
    points.push({
      rank: 2,
      title: 'Your cash buffer is thin',
      body: `Your accessible savings would cover ${aboutMonths(m.er)} of your current spending.`,
    });
  }
  if (d.notes.some((n) => /Balance growing on/i.test(n))) {
    points.push({
      rank: 3,
      title: 'At least one balance grows even when you pay',
      body: 'On one of your debts, the minimum payment is smaller than the interest charged each month, so what you owe goes up.',
    });
  }
  if (m.cur === null && d.creditStress.revolvingLines > 0) {
    points.push({
      rank: 4,
      title: 'We could not check your credit usage',
      body: 'No credit limit was given for a card or credit line, so we left this blank rather than guess.',
    });
  } else if (m.cur !== null && m.cur > 70) {
    points.push({
      rank: 4,
      title: 'You are using a large share of your available credit',
      body: `You are using about ${pct(m.cur)} of the credit limit you gave us.`,
    });
  }
  if (m.unsecuredLines >= 3) {
    points.push({
      rank: 5,
      title: 'Several unsecured debts are running at once',
      body: `You are managing ${m.unsecuredLines} unsecured debts with a balance.`,
    });
  }
  if (m.interestBurn > 0 && d.tiers.foir < 3) {
    points.push({
      rank: 6,
      title: 'Interest is eating into every payment',
      body: `About ${inr(m.interestBurn)} a month goes on interest before you reduce anything you owe.`,
    });
  }

  return points.sort((a, b) => a.rank - b.rank).slice(0, 4).map(({ title, body }) => ({ title, body }));
}

/** The payoff comparison, told as two options rather than a table of strategies. */
function payoffNarrative(d) {
  const av = d.avalanche;
  const sn = d.snowball;
  const feasible = Boolean(av?.feasible && sn?.feasible);

  if (!feasible) {
    const broken = !av?.feasible ? av : sn;
    const shortfall = broken?.reason === 'BUDGET_BELOW_INTEREST';
    return {
      feasible: false,
      intro: 'There is no realistic payoff plan yet, and we will not pretend there is.',
      detail: shortfall
        ? `Your minimum payments and spare cash come to ${inr(av?.monthlyBudget ?? 0)} a month, but the interest alone is ${inr(d.strategy.monthlyInterest ?? 0)}. That is about ${inr(d.strategy.shortfall ?? 0)} a month short of standing still.`
        : 'At the current payments, the debt does not clear within a realistic timeframe.',
      nextStep: 'The way out of this is not a repayment order. It is either more money available each month, or a conversation with your lenders about lowering the payments.',
    };
  }

  const difference = Math.abs(sn.totalInterest - av.totalInterest);
  const cheaper = sn.totalInterest >= av.totalInterest ? 'highest' : 'smallest';
  const sameLength = av.months === sn.months;
  const pickAvalanche = d.strategy.pick === 'avalanche';

  let suggestion;
  if (difference === 0) {
    suggestion = 'My suggestion: either approach works equally well here. Pick the one you will actually stick to.';
  } else if (pickAvalanche) {
    suggestion = `My suggestion: start with the highest-interest debt. The smallest-balance approach would cost you about ${inr(difference)} more, and that is not worth paying here.`;
  } else {
    suggestion = `My suggestion: start with your smallest balance. It costs about ${inr(difference)} more in total, but clearing a debt early keeps a lot of people going, and the difference is small.`;
  }

  return {
    feasible: true,
    intro: 'There are two sensible ways to pay this down.',
    optionA: {
      name: 'Highest-interest first',
      technical: 'Avalanche',
      months: av.months,
      interest: av.totalInterest,
      text: `You would be debt-free in about ${av.months} months, paying roughly ${inr(av.totalInterest)} in interest.`,
      recommended: pickAvalanche,
    },
    optionB: {
      name: 'Smallest balance first',
      technical: 'Snowball',
      months: sn.months,
      interest: sn.totalInterest,
      text: `You would be debt-free in about ${sn.months} months, paying roughly ${inr(sn.totalInterest)} in interest.`,
      recommended: !pickAvalanche,
    },
    difference,
    differenceText:
      difference === 0
        ? 'Both approaches cost you the same here, so pick whichever keeps you motivated.'
        : `The ${cheaper}-${cheaper === 'highest' ? 'interest' : 'balance'} approach saves you about ${inr(difference)}${sameLength ? ', over the same number of months' : ''}.`,
    suggestion,
    order: av.payoffOrder ?? [],
  };
}

/** Missing data, stated plainly. These are the report's "assumptions and limitations". */
function assumptions(d, extras) {
  const out = [];
  for (const q of d.questions ?? []) out.push(q.message);
  if (extras?.profile?.familyHelp) {
    out.push('Family help is shown for context only. It is not counted as income, because it cannot be verified and may not be there when you need it.');
  }
  out.push('These figures come from the numbers you entered. Nothing here is legal, tax or investment advice.');
  return out;
}

/**
 * @param {object} diagnostic a successful runDiagnosticV2 result
 * @param {{profile?:object}} [extras]
 */
export function buildNarrative(diagnostic, extras = {}) {
  const m = diagnostic.metrics;
  const plain = PLAIN_TIER[diagnostic.tier];

  const position = [];
  position.push(`You're bringing home about ${inr(m.incomeEff)} a month.`);
  if (m.coreExpenses > 0) {
    position.push(
      `Essential living costs come to about ${inr(m.coreExpenses)} a month` +
        (m.rent > 0 ? `, and housing is another ${inr(m.rent)}.` : '.'),
    );
  } else if (m.rent > 0) {
    position.push(`Housing costs come to about ${inr(m.rent)} a month.`);
  }
  if (m.totalEmi > 0) {
    position.push(`Your minimum debt payments are ${inr(m.totalEmi)} a month.`);
  }
  position.push(
    m.dcf >= 0
      ? `After all of that, you have roughly ${inr(m.dcf)} left each month.`
      : `That leaves you about ${inr(Math.abs(m.dcf))} short every month.`,
  );

  const whatItMeans = [breathingRoom(m.dcf, m.dcfPct)];
  if (Number.isFinite(m.er)) {
    whatItMeans.push(`Your savings would cover ${aboutMonths(m.er)} of your current spending if your income stopped. ${bufferSentence(m.er)}`);
  }
  if (m.totalBalance > 0) {
    whatItMeans.push(
      `In total you owe about ${inr(m.totalBalance)}, which is roughly ${m.dtiMonths.toFixed(1)} months of your income.` +
        (m.interestBurn > 0 ? ` About ${inr(m.interestBurn)} of that goes on interest every month.` : ''),
    );
  }

  return {
    tier: diagnostic.tier,
    tierLabel: diagnostic.tierLabel,
    plainTier: { ...plain, tier: diagnostic.tier, of: 4 },
    headline: HEADLINES[diagnostic.tier],
    position,
    whatItMeans,
    recommendation: RECOMMENDATION_BY_TIER[diagnostic.tier],
    pressurePoints: pressurePoints(diagnostic),
    actions: (ACTIONS_BY_TIER[diagnostic.tier] ?? []).slice(0, 5),
    payoff: payoffNarrative(diagnostic),
    improvement: improvementSentences(diagnostic.distance),
    assumptions: assumptions(diagnostic, extras),
    checks: (diagnostic.warnings ?? []).map((w) => w.message),
  };
}

export default { buildNarrative };
