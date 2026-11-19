import assert from "node:assert/strict";
import test from "node:test";
import { backoffDelayMs, classifyPageSpeedError } from "./pagespeed-errors";

test("anonymous quota explains the missing key on this server", () => {
  const result = classifyPageSpeedError(429, "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'", false);
  assert.equal(result.kind, "quota-anonymous");
  assert.equal(result.retryable, false);
  assert.match(result.message, /GOOGLE_PAGESPEED_API_KEY/);
});

test("daily key quota fails fast; per-minute quota is retryable", () => {
  const daily = classifyPageSpeedError(429, "Quota exceeded … limit 'Queries per day'", true);
  assert.equal(daily.kind, "quota-daily");
  assert.equal(daily.retryable, false);
  const rate = classifyPageSpeedError(429, "Quota exceeded … limit 'Queries per minute'", true);
  assert.equal(rate.kind, "quota-rate");
  assert.equal(rate.retryable, true);
});

test("403 distinguishes a disabled API from key restrictions", () => {
  assert.equal(
    classifyPageSpeedError(403, "PageSpeed Insights API has not been used in project 123 before or it is disabled.", true).kind,
    "api-disabled",
  );
  assert.equal(
    classifyPageSpeedError(403, "Requests from referer <empty> are blocked.", true).kind,
    "key-restricted",
  );
});

test("400 invalid key and unreachable pages get specific messages", () => {
  assert.equal(classifyPageSpeedError(400, "API key not valid. Please pass a valid API key.", true).kind, "key-invalid");
  assert.equal(
    classifyPageSpeedError(400, "Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page", true).kind,
    "page-unreachable",
  );
  const status = classifyPageSpeedError(400, "Lighthouse returned error: ERRORED_DOCUMENT_REQUEST. (Status code: 404)", true);
  assert.equal(status.kind, "page-status");
  assert.match(status.message, /404/);
});

test("5xx is retryable", () => {
  const result = classifyPageSpeedError(503, "Backend Error", true);
  assert.equal(result.kind, "provider-unavailable");
  assert.equal(result.retryable, true);
});

test("backoff grows exponentially within a cap", () => {
  const max = () => 1;
  const min = () => 0;
  assert.equal(backoffDelayMs(0, 2000, 20000, max), 2000);
  assert.equal(backoffDelayMs(0, 2000, 20000, min), 1000);
  assert.equal(backoffDelayMs(2, 2000, 20000, max), 8000);
  assert.equal(backoffDelayMs(10, 2000, 20000, max), 20000);
});
