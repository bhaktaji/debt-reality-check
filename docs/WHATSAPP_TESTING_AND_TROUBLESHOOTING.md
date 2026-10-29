# WhatsApp Cloud API Testing, Monitoring & Troubleshooting Guide

This guide provides step-by-step instructions for testing the **Debt Reality Checker** WhatsApp bot end-to-end, monitoring its health and logs, and recovering when a Meta access token expires.

---

## 1. End-to-End WhatsApp Testing

Follow these steps in order to verify that incoming WhatsApp messages reach the server and receive replies:

1. **Verify Webhook Configuration and Subscriptions in Meta**:
   - Open [Meta for Developers](https://developers.facebook.com/apps/), select your app, and navigate to **WhatsApp → Configuration → Webhook**.
   - Confirm that the **Callback URL** is set to `https://debt-reality-checker.ai.studio/webhook` and verified.
   - Under **Webhook fields**, confirm that **`messages`** is subscribed.
   - Ensure your Meta app is subscribed to your WhatsApp Business Account (`subscribed_apps` edge) and that your personal test phone number is added as an approved recipient under **WhatsApp → API Setup**.

2. **Send a Test Message (`HI`)**:
   - From your authorized WhatsApp test recipient phone number, send `HI` to the Meta WhatsApp test number.
   - Confirm that you receive the Debt Reality Checker welcome and privacy notice reply on WhatsApp.

3. **Check `/readyz` Diagnostic Metrics**:
   - Open [https://debt-reality-checker.ai.studio/readyz](https://debt-reality-checker.ai.studio/readyz) in your browser or run:
     ```bash
     curl -sS https://debt-reality-checker.ai.studio/readyz
     ```
   - Inspect the `metrics` object in the JSON response:
     - `messagesProcessed`: Should increment by `1` for each completed incoming message turn.
     - `outboundSent`: Should increment by `1` (or more if a long report was split into chunks) for each Graph API reply delivered.
     - `lastWebhookSummary`: Shows the classification of the most recent webhook payload (`"eventKind": "incoming_message"`, `"status_notification"`, or `"webhook_test_event"`), along with `messageCount` and `messageTypes`.
     - `lastOutboundError`: Should be `null` when outbound replies succeed. If an outbound send failed, it records `httpStatus`, `metaErrorCode`, `metaErrorSubcode`, `errorType`, and a redacted `reason`.

4. **Troubleshooting Common Failures**:
   - **No incoming `POST /webhook` appears when you send a message**:
     - Verify that your Meta app is attached to the WhatsApp Business Account via `GET /v21.0/<WABA_ID>/subscribed_apps`. If your app ID is missing from `data`, subscribe it via `POST /v21.0/<WABA_ID>/subscribed_apps` using a token with `whatsapp_business_management` permission.
     - Confirm the Cloud Run service allows unauthenticated HTTPS requests (`allUsers` with `Cloud Run Invoker`) so Meta's webhook requests are not blocked before reaching the container.
   - **Webhook arrives (`webhooksReceived` increments), but `signatureFailures` increments (`HTTP 401`)**:
     - `WHATSAPP_APP_SECRET` in the deployed Cloud Run environment does not match the **App Secret** in **Meta for Developers → App Settings → Basic**.
   - **Webhook arrives, `outboundFailed` increments, and `lastOutboundError.metaErrorCode` is `190` (`HTTP 401`)**:
     - `WHATSAPP_ACCESS_TOKEN` in the deployed Cloud Run revision has expired or been invalidated. Follow [Section 3: Access Token Expiry Recovery](#3-access-token-expiry-recovery).
   - **Webhook arrives, `outboundFailed` increments, and `lastOutboundError.metaErrorCode` is `131030` (`HTTP 400`)**:
     - The recipient phone number is not on the sandbox allow-list under **WhatsApp → API Setup → Send and receive messages** (this also occurs when clicking the synthetic **"Test"** button in the Meta Webhook dashboard, which uses a dummy US number).

---

## 2. Useful Monitoring Links

- **Application health and metrics:** [https://debt-reality-checker.ai.studio/readyz](https://debt-reality-checker.ai.studio/readyz)
- **Google Cloud Console Logs Explorer:** [https://console.cloud.google.com/logs/query?project=luminous-joy-1w1rw](https://console.cloud.google.com/logs/query?project=luminous-joy-1w1rw)
- **Meta for Developers:** [https://developers.facebook.com/apps/](https://developers.facebook.com/apps/)
- **WhatsApp Cloud API documentation:** [https://developers.facebook.com/docs/whatsapp/cloud-api/](https://developers.facebook.com/docs/whatsapp/cloud-api/)

### How to Use These Tools Together
- **`/readyz`** provides an immediate snapshot of application readiness (`ready`, `configured`, `dbDriver`) and live webhook counters (`webhooksReceived`, `messagesProcessed`, `outboundSent`, `lastWebhookSummary`, and `lastOutboundError`).
- **Google Cloud Console Logs Explorer** provides full request and container logs (`WEBHOOK_EVENT_CLASSIFIED`, `CLOUD_API_SEND_FAILED`, `WEBHOOK_MESSAGE_PROCESSING_FAILED`, and HTTP request traces) to diagnose historical webhook deliveries and upstream Graph API errors.

> **Privacy & Security Warning:** Never copy, paste, screenshot, or share access tokens, app secrets, verification tokens, personal phone numbers, raw message contents, or sensitive financial figures from logs or configuration screens.

---

## 3. Access Token Expiry Recovery

Temporary access tokens generated from Meta's **API Setup** page expire after roughly 24 hours (`OAuthException` code `190` / subcode `463`). When a token expires, follow these steps in order:

1. **Generate a Fresh Access Token in Meta**:
   - Open [Meta for Developers](https://developers.facebook.com/apps/), select your app, and navigate to **WhatsApp → API Setup** (or **Meta Business Settings → System Users** for a permanent token).
   - Obtain a fresh access token that includes the required `whatsapp_business_messaging` and `whatsapp_business_management` permissions.

2. **Update `WHATSAPP_ACCESS_TOKEN` in Your Deployment Secrets**:
   - Open the **Secrets / Environment Variables** configuration in Google AI Studio (or Google Cloud Run Variables & Secrets) and update `WHATSAPP_ACCESS_TOKEN` with the new token.
   - *(Note: Updating a local `.env` file in the workspace only affects local development; it **does not** automatically update the deployed Cloud Run service.)*

3. **Deploy a New Cloud Run Revision**:
   - Trigger a new deployment (**Deploy** in AI Studio or **Edit & Deploy New Revision** in Cloud Run) so the running container restarts with the updated `WHATSAPP_ACCESS_TOKEN` environment variable.

4. **Confirm Deployment Health and Logs**:
   - Check [https://debt-reality-checker.ai.studio/readyz](https://debt-reality-checker.ai.studio/readyz) and confirm `"ready": true` and `"configured": true`.
   - Check [Google Cloud Console Logs Explorer](https://console.cloud.google.com/logs/query?project=luminous-joy-1w1rw) to confirm the new revision started without authentication or configuration errors.

5. **Send a Real WhatsApp Test Message**:
   - Send `HI` from your authorized WhatsApp test phone to the Meta test number and confirm that the bot replies on WhatsApp.

6. **Diagnose Any Remaining Failure Safely**:
   - If no reply arrives, inspect `lastOutboundError` in `/readyz` and check Cloud Run logs for `CLOUD_API_SEND_FAILED` or `WEBHOOK_MESSAGE_PROCESSING_FAILED` events—never exposing secret values when sharing error codes.

---

## 4. Steps That Normally Do Not Need Repeating

When recovering from a normal **access token expiry**, you **do not** need to repeat the following one-time setup steps:

- **Re-subscribing the Meta app to the WhatsApp Business Account (WABA)**: Once your app appears in `GET /v21.0/<WABA_ID>/subscribed_apps`, that WABA-to-app binding persists across token refreshes.
- **Reconfiguring the webhook callback URL**: Your verified callback URL (`https://debt-reality-checker.ai.studio/webhook`) and subscribed `messages` field remain stored in Meta's app configuration.
- **Regenerating unrelated secrets**: Keep `PSEUDONYM_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_PHONE_NUMBER_ID` unchanged unless a credential was compromised or you switched Meta apps. (Rotating `PSEUDONYM_SECRET` changes derived user pseudonyms.)

### When to Re-Verify Instead of Blindly Reconfiguring
Only inspect or re-apply these settings if:
- You switched to a different Meta App ID or WABA ID, or
- Incoming WhatsApp messages stop producing `POST /webhook` requests in Cloud Run logs altogether.
In that case, first run a read-only check (`GET /v21.0/<WABA_ID>/subscribed_apps` and `GET /v21.0/<PHONE_NUMBER_ID>?fields=webhook_configuration`) to verify whether the subscription or callback URL actually changed before modifying production settings.

---

## 5. Security and Production Recommendations

- **Zero Secrets in Source Control or Docs**: Never commit `.env` files or paste real tokens, app secrets, verification tokens, or phone numbers into source code, documentation, issue trackers, or screenshots. Keep `.env.example` limited to variable names and empty/safe placeholders.
- **Use a System User Token for Production**: Temporary tokens from the **API Setup** screen expire daily and are intended only for sandbox testing. For steady operation, create a **System User** in **Meta Business Settings → Users → System Users**, assign the WhatsApp app and WABA, and generate a long-lived System User token with only the minimum required scopes (`whatsapp_business_messaging` and `whatsapp_business_management`). Document your token's expiration policy and revoke old tokens immediately in Meta Business Settings if rotated or compromised.
- **Protect Operational Endpoints (`/readyz`)**: The `/readyz` endpoint exposes operational counters and diagnostic error summaries (`lastWebhookSummary`, `lastOutboundError`). While it never includes tokens, phone numbers, or message contents, consider restricting external access or filtering detailed metrics in public production environments if operational telemetry should remain internal.

---

## 6. Final Verification Checklist

- [ ] **Webhook Delivery**: Sending a WhatsApp message from an authorized test number produces a `POST /webhook` entry in Cloud Run logs with HTTP `200`, and `/readyz` shows `lastWebhookSummary.eventKind: "incoming_message"`.
- [ ] **Message Processing**: `metrics.messagesProcessed` increments and `metrics.messagesFailed` remains `0`.
- [ ] **Outbound Replies**: `metrics.outboundSent` increments, `metrics.lastOutboundError` is `null`, and the reply appears on the recipient's WhatsApp device.
- [ ] **Error-Free Logs**: Cloud Run logs show no `WEBHOOK_SIGNATURE_INVALID` (`401`), `CLOUD_API_SEND_FAILED`, or unhandled exceptions.
- [ ] **Token-Expiry Recovery Tested**: `WHATSAPP_ACCESS_TOKEN` is updated in the deployment's Secrets/environment configuration and a new Cloud Run revision is deployed whenever a token is refreshed.
