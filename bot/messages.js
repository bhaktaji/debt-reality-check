/**
 * bot/messages.js
 * Every user-facing string, in one place, so copy can be snapshot-tested.
 *
 * Tone rules (F-25 / F.3): state facts and the next step. Candour about the numbers,
 * never about the person. The words "insolvent" and "prohibited" never appear.
 * Pure: no I/O.
 */

export const NOTICE_VERSION = 'v1';

export const DISCLAIMER_SHORT =
  'Informational only - not legal, tax or investment advice.';

export const FIRST_CONTACT = [
  'Debt Reality Check. A deterministic solvency diagnostic. No lending, no referrals, no sales.',
  '',
  'Before we start, here is exactly what happens to your data:',
  '1. Your channel id is stored only as a one-way hash, never as a phone number.',
  '2. Income, costs, debts and reserves are stored as numbers so you can see your history.',
  '3. Data linked to you is deleted after 90 days of inactivity, or immediately when you send DELETE MY DATA.',
  '4. Message text is never written to a log.',
  '',
  `Send AGREE to continue, or HELP for the command list. ${DISCLAIMER_SHORT}`,
].join('\n');

export const CONSENT_ACK = 'Thank you. Consent recorded. Send AUDIT to start, or just type an expense like "medicine 400".';

export const HELP = [
  'COMMANDS',
  'AUDIT - work out where you stand (income, costs, debts)',
  'SUMMARY - today and the last 30 days of your spending',
  'REPORT - your last audit, in plain English',
  'HISTORY - how your position has moved over time',
  'SET CURRENCY INR - set the display currency (INR only today)',
  'CANCEL - stop the current flow (your data is kept)',
  'BACK - go back one step in the audit',
  'DELETE MY DATA - erase everything stored about you',
  'HELP - this list',
  '',
  'You can also log an expense at any time, e.g. "electricity 1500" or "2 eggs 30".',
  '',
  DISCLAIMER_SHORT,
].join('\n');

export const CANCEL_ACK = 'Cancelled. Nothing was lost. Send AUDIT to resume or type an expense.';

export const BACK_ACK = 'Stepped back.';

export const NO_BACK = 'There is nothing to go back to. Send AUDIT to start.';

export const EXPENSE_LOGGED = (amountLabel, category, essential) => {
  const tag = essential === true ? 'essential' : essential === false ? 'discretionary' : 'uncategorised';
  return `Logged ${amountLabel} - ${category} (${tag}).`;
};

export const EXPENSE_ASK_ESSENTIAL =
  'I cannot tell whether that is essential or discretionary. Reply E for essential or D for discretionary.';

export const EXPENSE_ASK_AMOUNT =
  'I could not find a single clear amount. Send it like "medicine 400" or "400 medicine".';

export const EXPENSE_CONFIRM = (amountLabel, description) =>
  `I read that as ${amountLabel} for "${description || 'an unnamed item'}". Reply YES to log it, or send it again with the correct amount.`;

export const NO_EXPENSE = 'I could not read an amount there. Send HELP for the command list.';

export const SUMMARY_HEADER = 'SPENDING SUMMARY';
export const NO_EXPENSES = 'No expenses logged yet. Type something like "medicine 400".';

export const REPORT_NEEDS_AUDIT = 'No audit yet. Send AUDIT to run one.';

export const DELETE_ACK = 'Everything stored about you has been erased. Send HELP if you want to start again.';

export const SET_CURRENCY_ACK = (code) => `Display currency set to ${code}.`;

export const SET_CURRENCY_UNSUPPORTED = 'Only INR is supported today. Send "SET CURRENCY INR".';

export const AGREE_PROMPT = 'Send AGREE first so we both know where we stand, or HELP for the command list.';

/** Crisis escalation (F.3). Stops the audit; never continues debt maths in this reply. */
export const CRISIS_REPLY = [
  'Thank you for telling me. What you are carrying sounds heavy, and money pressure on top of it is a lot.',
  '',
  'I am a calculator, not a person, so I am going to stop the audit here rather than run numbers at you.',
  '',
  'If you can, tell someone you trust today - a friend, a family member, a doctor. If you are in India, Tele-MANAS is on 14416 (24x7, free). If you are elsewhere, your local emergency number or crisis line works too.',
  '',
  'When you are ready, and not before, send AUDIT and we will pick this up again.',
].join('\n');

export const HARASSMENT_GUIDANCE = [
  'Recovery harassment:',
  '- Keep screenshots of messages and a note of call times and numbers.',
  '- Complain through the lender\'s own grievance channel first, in writing.',
  '- If the lender is a regulated entity, the RBI complaint route is available; check the RBI digital-lending app directory to confirm who you are dealing with.',
  '- Threats or extortion can also go to the national cybercrime reporting channel.',
  'Verify current contact details before you use them. This is not legal advice.',
].join('\n');

/** Phrases that indicate hopelessness or self-harm intent. Deliberately specific. */
export const CRISIS_PATTERNS = [
  /\b(kill|killing)\s+myself\b/i,
  /\bend\s+(my|it)\s+(life|all)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(live|be here)\b/i,
  /\bself[-\s]?harm\b/i,
  /\bcut\s+myself\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\bnot\s+worth\s+living\b/i,
  /\bsuicidal\b/i,
  /\bsuicide\b/i,
];

/** True when a message should stop the flow and escalate. */
export function isCrisisMessage(text) {
  if (!text) return false;
  return CRISIS_PATTERNS.some((re) => re.test(String(text)));
}

/** Harassment / threat language -> surface guidance alongside the normal flow. */
export const HARASSMENT_PATTERNS = [
  /\b(harass|harassment|threat|threaten|threatened|abusive|abuse|blackmail|extort|defam)\w*/i,
  /\bcalling\s+my\s+(family|contacts|relatives)\b/i,
];

export function isHarassmentMessage(text) {
  if (!text) return false;
  return HARASSMENT_PATTERNS.some((re) => re.test(String(text)));
}

/** Audit question copy. Plain English, no finance terms. */
export const AUDIT_INTRO =
  'Solvency audit. Eight quick questions, then your debts. Send CANCEL at any point or BACK to correct the last answer.';

export const AUDIT_QUESTIONS = {
  netIncome:
    'Q1. How much money comes into your household each month, after tax? (This is your take-home income - the amount you actually receive.)',
  incomeHistory:
    'Q2. Is your income roughly the same every month? If it changes a lot, list the last 3 to 6 monthly amounts, separated by commas. Send SKIP if it is steady.',
  rent: 'Q3. What is your monthly rent or housing payment? Send 0 if you do not pay any.',
  coreExpenses:
    'Q4. About how much do you spend each month on essentials - food, electricity, medicine, transport, school fees? Leave out rent and loan payments; we count those separately.',
  liquidReserves:
    'Q5. How much money could you use right now if your income stopped? Cash and savings you can reach within a few days. Send 0 if you have none.',
  earners: 'Q6. How many people currently earn money in the household?',
  dependents: 'Q7. How many people depend financially on this household income without earning themselves?',
  familyHelp:
    'Q8. Could family help you out financially if you needed it? Yes or no. We show it for context and never count it as income.',
  debtIntro: 'Now your debts, one at a time. Send DONE when you have entered them all.',
  debtName: 'What would you like to call this debt? (for example "HDFC credit card")',
  debtType:
    'What kind of debt is it? Reply 1 credit card, 2 personal loan, 3 buy now pay later, 4 loan app, 5 vehicle loan, 6 something else.',
  debtSecured: 'Is something valuable tied to this loan, such as your vehicle or property? Yes or no.',
  debtBalance: 'How much do you still owe?',
  debtMinPayment: 'What is the minimum payment each month?',
  debtApr:
    'What interest rate does it charge? Send a yearly rate like "42", or "flat 24 6" for 24% flat over 6 months, or "0.1 per day".',
  debtCreditLimit: 'What is your credit limit? Send SKIP if you do not know - we will not guess it.',
  debtMore: 'Send NEXT for another debt, or DONE to finish.',
};

export const AUDIT_SUMMARY_INTRO = 'Here is what I have. Send DONE to run the diagnostic, or BACK to change something.';

export const AUDIT_ABORTED = 'Audit cancelled.';

export const UNSUPPORTED_MESSAGE_TYPE =
  'I can only read text messages right now. Please type your amount or command (send HELP for options).';

export const RESUME_NONE =
  'There is no unfinished audit to resume. Send AUDIT to start a solvency check, or REPORT to view your last result.';

export const EDIT_PROMPT =
  'To change a specific answer, send EDIT INCOME, EDIT RENT, EDIT COSTS, EDIT RESERVES, EDIT HOUSEHOLD or EDIT DEBTS (or send AUDIT to start fresh).';

export default {
  NOTICE_VERSION, DISCLAIMER_SHORT, FIRST_CONTACT, CONSENT_ACK, HELP, CANCEL_ACK, BACK_ACK, NO_BACK,
  EXPENSE_LOGGED, EXPENSE_ASK_ESSENTIAL, EXPENSE_ASK_AMOUNT, EXPENSE_CONFIRM, NO_EXPENSE,
  SUMMARY_HEADER, NO_EXPENSES, REPORT_NEEDS_AUDIT, DELETE_ACK, SET_CURRENCY_ACK,
  SET_CURRENCY_UNSUPPORTED, AGREE_PROMPT, CRISIS_REPLY, HARASSMENT_GUIDANCE, AUDIT_INTRO,
  AUDIT_QUESTIONS, AUDIT_SUMMARY_INTRO, AUDIT_ABORTED, UNSUPPORTED_MESSAGE_TYPE, RESUME_NONE, EDIT_PROMPT,
  isCrisisMessage, isHarassmentMessage,
};
