---
name: Multi-shift single-row attendance reads
description: After enabling multiple attendance shifts per worker per day, code that reads only one attendance row per day is a latent bug.
---

The attendance table allows MULTIPLE rows (shifts) per worker per day (the
unique worker/day index was dropped). Any code that does
`const [att] = await db.select().from(attendanceTable).where(workerId && date)`
silently grabs an arbitrary single shift (often the closed morning one) and
misreads the worker's state.

**Why:** the weighing gate in `weighRecords.ts` did exactly this — a worker
with a closed morning shift + an open afternoon shift was rejected ("sem
entrada" / "já deu saída há mais de 1h") even though they were checked in for
the afternoon.

**How to apply:** when gating on attendance for a day, fetch ALL shifts for
worker+date and aggregate: a worker is "currently checked in" if ANY shift has
`checkOutAt == null`; only when every shift is closed do you apply the
last-check-out grace window (max of all `checkOutAt`). reports.ts and
timesheet.ts already aggregate; mirror that pattern anywhere new.
