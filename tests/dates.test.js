import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween,
  formatShortDate,
  isIsoDate,
  monthKey,
  monthLabel,
  parseLooseDate,
  todayIso,
} from "../src/js/domain/dates.js";

test("isIsoDate accepts real calendar dates only", () => {
  assert.ok(isIsoDate("2026-08-20"));
  assert.ok(isIsoDate("2028-02-29"), "leap day");
  for (const bad of ["2026-02-29", "2026-13-01", "2026-00-10", "2026-8-20", "20/08/2026", "", null, 20260820]) {
    assert.equal(isIsoDate(bad), false, String(bad));
  }
});

test("parseLooseDate reads ISO and day-first dates", () => {
  assert.equal(parseLooseDate("2026-8-5"), "2026-08-05");
  assert.equal(parseLooseDate(" 20/08/2026 "), "2026-08-20");
  assert.equal(parseLooseDate("20.08.26"), "2026-08-20");
  assert.equal(parseLooseDate("5-8-2026"), "2026-08-05");
  assert.equal(parseLooseDate("20/08/2026 14:30"), "2026-08-20", "time part ignored");
});

test("parseLooseDate rejects impossible and month-first dates", () => {
  assert.equal(parseLooseDate("2026-13-45"), null);
  assert.equal(parseLooseDate("08/20/2026"), null, "month 20 does not exist: not silently swapped");
  assert.equal(parseLooseDate("31/02/2026"), null);
  assert.equal(parseLooseDate("20/08/202"), null, "three-digit year");
  assert.equal(parseLooseDate(undefined), null);
});

test("formatShortDate, monthKey and monthLabel", () => {
  assert.equal(formatShortDate("2026-08-20"), "20/08/26");
  assert.equal(formatShortDate(null), "—");
  assert.equal(formatShortDate("not-a-date"), "—");
  assert.equal(monthKey("2026-08-20"), "2026-08");
  assert.equal(monthLabel("2026-08"), "août 2026");
  assert.equal(monthLabel("2026-12", { short: true }), "déc.");
});

test("daysBetween counts whole days and never goes negative", () => {
  assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "across a DST change");
  assert.equal(daysBetween("2026-11-02", "2026-10-30"), 0);
});

test("todayIso uses the local calendar day", () => {
  const now = new Date(2026, 10, 18, 23, 59); // local time, late evening
  assert.equal(todayIso(now), "2026-11-18");
});
