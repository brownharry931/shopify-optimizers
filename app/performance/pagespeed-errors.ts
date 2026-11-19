/**
 * Classifies Google PageSpeed Insights API failures into actionable,
 * merchant-readable messages and decides whether a retry can help.
 * Pure module: no network, no secrets.
 */

export type PageSpeedErrorKind =
  | "quota-daily"
  | "quota-rate"
  | "quota-anonymous"
  | "key-invalid"
  | "api-disabled"
  | "key-restricted"
  | "page-unreachable"
  | "page-not-html"
  | "page-status"
  | "bad-request"
  | "provider-unavailable"
  | "timeout"
  | "unknown";

export type ClassifiedPageSpeedError = {
  kind: PageSpeedErrorKind;
  retryable: boolean;
  message: string;
};

export class PageSpeedError extends Error {
  kind: PageSpeedErrorKind;
  retryable: boolean;
  constructor(classified: ClassifiedPageSpeedError) {
    super(classified.message);
    this.name = "PageSpeedError";
    this.kind = classified.kind;
    this.retryable = classified.retryable;
  }
}

export function classifyPageSpeedError(
  status: number,
  providerMessage: string,
  hasApiKey: boolean,
): ClassifiedPageSpeedError {
  const message = providerMessage || "";

  if (status === 429 || /quota|rate ?limit|RESOURCE_EXHAUSTED/i.test(message)) {
    if (!hasApiKey) {
      return {
        kind: "quota-anonymous",
        retryable: false,
        message:
          "No GOOGLE_PAGESPEED_API_KEY is set on this server, so scans use Google's shared anonymous quota, which is exhausted. Add the key to this environment and restart the server.",
      };
    }
    if (/per day|daily/i.test(message)) {
      return {
        kind: "quota-daily",
        retryable: false,
        message:
          "The daily PageSpeed quota for this app's Google API key is used up. It resets at midnight Pacific time; you can request a higher quota in Google Cloud Console.",
      };
    }
    return {
      kind: "quota-rate",
      retryable: true,
      message:
        "Google is limiting how fast this API key can run audits. Wait a minute and try again.",
    };
  }

  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(message)) {
    return {
      kind: "key-invalid",
      retryable: false,
      message:
        "Google rejected GOOGLE_PAGESPEED_API_KEY as invalid. Copy the key again from Google Cloud Console → Credentials and update the server environment.",
    };
  }

  if (status === 403) {
    if (/has not been used|is disabled|SERVICE_DISABLED|not enabled/i.test(message)) {
      return {
        kind: "api-disabled",
        retryable: false,
        message:
          "The PageSpeed Insights API is not enabled for the Google Cloud project that owns this API key. Enable “PageSpeed Insights API” in Google Cloud Console → APIs & Services.",
      };
    }
    if (/referer|referrer|IP address|blocked|restrict/i.test(message)) {
      return {
        kind: "key-restricted",
        retryable: false,
        message:
          "The API key's restrictions block server requests. In Google Cloud Console set Application restrictions to “None” (or allow your server's IP) and restrict the key to the PageSpeed Insights API instead.",
      };
    }
    return {
      kind: "key-invalid",
      retryable: false,
      message:
        "Google refused the request for this API key (HTTP 403). Check the key, its restrictions and that the PageSpeed Insights API is enabled.",
    };
  }

  if (/FAILED_DOCUMENT_REQUEST|DNS_FAILURE|NO_FCP|PROTOCOL_TIMEOUT|unable to reliably load/i.test(message)) {
    return {
      kind: "page-unreachable",
      retryable: false,
      message:
        "Lighthouse could not load the page. Make sure the storefront is published, not password-protected and reachable from the internet, then retry.",
    };
  }
  if (/NOT_HTML/i.test(message)) {
    return {
      kind: "page-not-html",
      retryable: false,
      message: "The page did not return HTML, so Lighthouse cannot audit it. Choose a storefront page.",
    };
  }
  const statusMatch = message.match(/ERRORED_DOCUMENT_REQUEST[^0-9]*(\d{3})?|Status code:\s*(\d{3})/i);
  if (statusMatch) {
    const code = statusMatch[1] || statusMatch[2];
    return {
      kind: "page-status",
      retryable: false,
      message: `The storefront answered with HTTP ${code ?? "error"} when Lighthouse requested it. Check that the page exists and is publicly accessible.`,
    };
  }

  if (status >= 500) {
    return {
      kind: "provider-unavailable",
      retryable: true,
      message: "Google PageSpeed Insights is temporarily unavailable. Please retry in a few minutes.",
    };
  }
  if (status === 400) {
    return {
      kind: "bad-request",
      retryable: false,
      message: "Google rejected the audit request. Check that the page URL is a public storefront page.",
    };
  }
  return {
    kind: "unknown",
    retryable: status === 0,
    message: "The PageSpeed audit could not complete. Please retry shortly.",
  };
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelayMs(attempt: number, baseMs = 2_000, capMs = 20_000, random = Math.random) {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}
