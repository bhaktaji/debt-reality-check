/**
 * tests/helpers/audit_driver.js
 * Drives the real bot router through a complete v2 audit conversation, so tests exercise
 * the same path a user does (consent -> questions -> echo confirmations -> debts -> DONE)
 * rather than calling the engine directly.
 */

/**
 * The friendly debt-type list, as shown in the question:
 *   1 credit card, 2 personal loan, 3 buy now pay later, 4 loan app, 5 vehicle loan, 6 something else.
 */
const TYPE_INDEX = { revolving: '1', installment: '2', bnpl: '3', loanapp: '4' };

/**
 * @param {object} router from createRouter()
 * @param {string} rawId
 * @param {object} profile
 * @returns {string[]} every reply produced, in order
 */
export function driveAudit(router, rawId, profile) {
  const transcript = [];
  const send = (text) => {
    const { replies } = router.handle(rawId, text);
    transcript.push(...replies);
    return replies;
  };

  send('AGREE');
  send('AUDIT');

  send(String(profile.netIncome));
  send('yes');

  send(profile.incomeHistory?.length ? profile.incomeHistory.join(', ') : 'skip');

  send(String(profile.rent ?? 0));
  send('yes');

  send(String(profile.coreExpenses ?? 0));
  send('yes');

  send(String(profile.liquidReserves ?? 0));
  send('yes');

  send(String(profile.earners ?? 1));
  send(String(profile.dependents ?? 0));
  send(profile.familyHelp ? 'yes' : 'no');

  for (const d of profile.debts || []) {
    send(d.name);
    send(TYPE_INDEX[d.type] ?? '1');
    send(d.secured ? 'yes' : 'no');
    send(String(d.balance));
    send('yes');
    send(String(d.minPayment));
    send('yes');
    send(String(d.apr));
    if (d.type === 'revolving') {
      // A missing limit is a legitimate answer: the tool must report utilisation as
      // unknown rather than inventing one.
      if (Number(d.creditLimit) > 0) {
        send(String(d.creditLimit));
        send('yes');
      } else {
        send('skip');
      }
    }
  }

  send('done');
  send('DONE');

  return transcript;
}

export default { driveAudit, TYPE_INDEX };
