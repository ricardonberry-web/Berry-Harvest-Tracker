---
name: Timezone edit round-trip (Lisbon tablet vs UTC dev)
description: How to convert entered wall-clock times to ISO when editing timestamps, and why the offset-subtraction hack breaks on the real device.
---

# Timezone round-trip when editing timestamps

When the user edits a time via `input[type=time]` or `input[type=datetime-local]`
(timesheet entry/exit in WorkersPage, pesagem timestamp in RankingPage), send it to
the API as:

```js
new Date(dateStr + "T" + timeStr + ":00").toISOString()   // type=time
new Date(datetimeLocalStr).toISOString()                   // type=datetime-local
```

The browser parses the string in the **device-local TZ** (Europe/Lisbon on the
tablet) and `toISOString()` gives the true UTC instant. All display paths use
`format(new Date(iso), "HH:mm")`, which reconverts to local — so the round-trip is
exact.

**Do NOT** apply the `new Date(d.getTime() - d.getTimezoneOffset()*60000)` "hack".
It double-applies the offset and shifts edited times **+1h** on a UTC+1 device
(Lisbon summer / WEST). It can also push a record across a date boundary, corrupting
daily filters/rankings/reports.

**Why it hid in dev:** the Replit container runs in **UTC** (`getTimezoneOffset()`
returns 0), so the hack is a no-op there — the bug only appears on the real Android
tablet in Portugal. TZ bugs in this app cannot be reproduced in the dev environment;
reason about them instead.

**How to apply:** any new timestamp-edit UI must use the plain `.toISOString()`
form above. Backend PATCH handlers just do `new Date(value)` and store it — no TZ
math server-side.
