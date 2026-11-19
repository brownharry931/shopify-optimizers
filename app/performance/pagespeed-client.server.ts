/**
 * Server-only PageSpeed Insights client.
 *
 * - The API key is read from the server environment on every call and is
 *   never returned to the browser.
 * - Identical in-flight requests (same URL + device) share one Google call.
 * - A process-wide queue caps concurrent Google calls, so bursts of audits
 *   wait their turn instead of tripping per-minute quota.
 * - Only transient failures (per-minute quota, 5xx, network) are retried,
 *   with exponential backoff and jitter; daily quota and configuration
 *   errors fail fast with a specific message.
 */
import type { ScanStrategy } from "./scan-targets";
import { CATEGORY_IDS } from "./lighthouse-report";
import {
  PageSpeedError,
  backoffDelayMs,
  classifyPageSpeedError,
} from "./pagespeed-errors";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 90_000;

let active = 0;
const waiting: Array<() => void> = [];
const inFlight = new Map<string, Promise<unknown>>();

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function pageSpeedKeyConfigured() {
  return Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim());
}

async function callOnce<T>(pageUrl: string, strategy: ScanStrategy): Promise<T> {
  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set("url", pageUrl);
  endpoint.searchParams.set("strategy", strategy);
  for (const category of CATEGORY_IDS) {
    endpoint.searchParams.append("category", category.toUpperCase().replace("-", "_"));
  }
  endpoint.searchParams.set("locale", "en");
  const key = process.env.GOOGLE_PAGESPEED_API_KEY?.trim();
  if (key) endpoint.searchParams.set("key", key);

  let lastError: PageSpeedError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let status = 0;
    let providerMessage = "";
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      const payload = (await response.json().catch(() => ({}))) as T & {
        error?: { message?: string };
      };
      if (response.ok && !payload.error) return payload;
      providerMessage = payload.error?.message || `HTTP ${status}`;
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        lastError = new PageSpeedError({
          kind: "timeout",
          retryable: false,
          message:
            "Google PageSpeed took longer than 90 seconds. The page may be very slow or unreachable; retry shortly.",
        });
        break;
      }
      providerMessage = "network error";
    }
    lastError = new PageSpeedError(classifyPageSpeedError(status, providerMessage, Boolean(key)));
    // Log the provider's wording server-side only (never includes the key).
    console.warn("PageSpeed request failed", {
      status,
      kind: lastError.kind,
      attempt: attempt + 1,
      provider: providerMessage.slice(0, 300),
    });
    if (!lastError.retryable || attempt === MAX_ATTEMPTS - 1) break;
    await sleep(backoffDelayMs(attempt));
  }
  throw lastError ?? new PageSpeedError(classifyPageSpeedError(0, "", Boolean(key)));
}

/** Run (or join an identical in-flight) PageSpeed Insights request. */
export function runPageSpeed<T>(pageUrl: string, strategy: ScanStrategy): Promise<T> {
  const dedupeKey = `${strategy}|${pageUrl}`;
  const existing = inFlight.get(dedupeKey);
  if (existing) return existing as Promise<T>;
  const request = withSlot(() => callOnce<T>(pageUrl, strategy)).finally(() => {
    inFlight.delete(dedupeKey);
  });
  inFlight.set(dedupeKey, request);
  return request;
}

/** For diagnostics/tests. */
export function pageSpeedQueueState() {
  return { active, waiting: waiting.length, inFlight: inFlight.size };
}
