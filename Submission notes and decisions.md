# Submission notes and decisions

Used Composer 2.5 (impressed by it's speed btw) since I'm out of Claude credits (lol), to write code quickly, I designed the data model, schema, endpoint list, and idempotency/retry logic myself. Reviewing race contentions, deduplication and guaranteed email delivery stuff brainstorming with the llm; all tradeoffs and scoping calls are mine.

Used one SQLite table, `session_id` unique for dedupe, so like the first write wins. Duplicate `/ingest` returns existing row, no reprocess; if winner still processing, waiter polls until not `received`. If two ingests hit the same `session_id` at once, only the insert winner runs `processForm`, the other waits for that to finish so you dont get back a half processed row

I assumed the bot would call our API with `POST /bot/next` (post cause it cahnges state). Also kept Email separate from transform: form can be `ready` while email is still pending to be sent (`email_sent_at=null`). For emails used mock SendGrid, inline try + 60s worker, max 5 attempts, then log `email_delivery_exhausted`; `/retry` resets attempts. Didnt tie email to `ready` cause the bot shouldnt wait on SendGrid flaking, ops notification is separate from form being processable. In prod id use a transactional outbox table plus a worker that retries until sent and alerts if it gives up, swap mock for real SendGrid.

`src/forms/validate.ts` -
`processForm()` calls it first on every `/ingest` and `/retry` run. If the 3rd party adds fields we don't know about, we ignore them and process the rest. If they omit something required or send the wrong type (e.g. a number where we expect a string), we fail the form, keep the original JSON, and you can fix and `/retry` later. We don't guess or convert types to make bad data pass.


Didn't build: real email, list endpoint, batch retry-all, bot claim leases

## How to run

```bash
npm install
npm test
npm run dev
```

Server on `:3000`. DB at `data/forms.db` (gitignored). Delete that file for a fresh start

## Endpoints

* `POST /ingest` — 3rd party sends raw form
* `POST /bot/next` — bot gets oldest ready form, marks `delivered`
* `POST /retry` — re-run failed/stuck processing, or retry email (`session_id` in body)

## Statuses

* `received` — just landed, processing
* `ready` — transformed, bot queue (email might still be pending)
* `delivered` — bot took it, won't return again
* `failed` — validate/geocode/transform broke, raw kept

## Test commands (from project folder, server running)

```bash
cd /Users/navyasharma/Documents/dev/take-home-test
```

**1. Ingest John**

```bash
curl -s -X POST http://localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -d @src/forms/examples/person_one.json | jq '{status, session_id, email_sent_at, email_attempts, firstName: .transformed.firstName}'
```

**2. Bot takes John**

```bash
curl -s -X POST http://localhost:3000/bot/next | jq '{session_id: .form.session_id, firstName: .form.transformed.firstName}'
```

**3. Bot queue empty**

```bash
curl -s -X POST http://localhost:3000/bot/next | jq
```

**4. Ingest Andy**

```bash
curl -s -X POST http://localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -d @src/forms/examples/person_two.json | jq '{status, firstName: .transformed.firstName, gender: .transformed.gender}'
```

**5. Bot takes Andy**

```bash
curl -s -X POST http://localhost:3000/bot/next | jq '.form.transformed.firstName'
```

**6. Dedupe (re-send person_one)**

```bash
curl -s -X POST http://localhost:3000/ingest \
  -H 'Content-Type: application/json' \
  -d @src/forms/examples/person_one.json | jq '{status, firstName: .transformed.firstName}'
```

Expect `delivered`, still John.

**7. Retry** (need a `session_id` from DB or ingest response)

```bash
curl -s -X POST http://localhost:3000/retry \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"c8267b77-d796-451e-9948-e82f56412b56"}' | jq '{status, error, email_sent_at}'
```

**8. DB check**

```bash
sqlite3 data/forms.db "SELECT session_id, status, email_sent_at, email_attempts, error FROM forms;"
```

**Fresh start before demo:**

```bash
rm -f data/forms.db && npm run dev
```


failed transforms can be queried with - `SELECT session_id, status, error FROM forms WHERE status = 'failed'`, then call `/retry` with the ID. Email failures get a log line after 5 failed attempts, since nothing else would ever surface those.
