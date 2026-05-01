# Quorum — first-time setup runbook

You only do this once per environment. After that, `npm run dev` and `npm run deploy` are the day-to-day commands.

## 0. Prerequisites

- Node ≥ 20 (`node --version`)
- A Cloudflare account with Workers enabled
- A Telegram bot — talk to [@BotFather](https://t.me/BotFather), `/newbot`, save the token

## 1. Install + log in

```bash
cd quorum
npm install
npx wrangler login
```

## 2. Set secrets

`wrangler secret put` is interactive — it prompts for the value, never put it on the command line.

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
# paste the token from @BotFather

npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
# paste a self-generated random hex string:
#   openssl rand -hex 32
# This is NOT issued by Telegram. Telegram echoes it back on every
# webhook hit via the `X-Telegram-Bot-Api-Secret-Token` header so we
# can verify the request really came from Telegram.

# Optional — only if you wire /gh skills extraction:
npx wrangler secret put GITHUB_TOKEN
```

## 3. Deploy the Worker

```bash
npx wrangler deploy
```

Note the deployed URL — something like `https://quorum.<subdomain>.workers.dev`. The default `*.workers.dev` cert is valid HTTPS, which is all Telegram requires.

## 4. Tell Telegram where to send updates

Replace `<URL>`, `<TOKEN>`, `<SECRET>` with your values. **Same `<SECRET>` you set in step 2 as `TELEGRAM_WEBHOOK_SECRET`.** Telegram will echo it back to us on every update.

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "<URL>/webhook",
    "secret_token": "<SECRET>",
    "allowed_updates": ["message","edited_message","callback_query","my_chat_member"]
  }'
```

You should get `{"ok":true,"result":true,"description":"Webhook was set"}`.

Verify with:

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

`pending_update_count` should drop to 0 after the bot starts processing.

## 5. Add the bot to your test group

1. In Telegram → bot's profile → Add to Group → pick your team's test group
2. **Crucial for groups:** message [@BotFather](https://t.me/BotFather) → `/setprivacy` → choose your bot → **Disable**. Otherwise the bot only sees messages that mention it or commands.
3. Send `/start` in the group. You should get the help message back.
4. Send any non-command text. The bot should echo `echo: <your text>` (H+1 DoD).
5. Send `/idea something we should build`. You should get `Idea #1 added — "..."`.

If nothing comes back, `npm run tail` shows live Worker logs.

## 6. Common breakage and fixes

| Symptom | Likely cause |
|---|---|
| `unauthorized` 401 in tail | `TELEGRAM_WEBHOOK_SECRET` mismatch between `wrangler secret put` and `setWebhook` `secret_token` |
| `bot.handleUpdate is not a function` | grammY version skew — `npm install grammy@latest` |
| `this.sql is not a function` | Migration tag wrong in `wrangler.jsonc` — must be `new_sqlite_classes`, NOT `new_classes` |
| Bot ignores group messages | Group privacy mode still on — see step 5.2 |
| `getWebhookInfo` shows `last_error_message: SSL` | You hit a non-`workers.dev` custom domain without a valid cert. Stay on `*.workers.dev` for now. |
