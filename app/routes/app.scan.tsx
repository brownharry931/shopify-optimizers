import { useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVerifiedSubscription } from "../billing/billing.server";
import prisma from "../db.server";
import { publicScan, runStorefrontScan } from "../performance/scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [access, latestScan] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    prisma.performanceScan.findFirst({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    canScan: access.isVerified && access.hasActiveSubscription,
    subscriptionVerified: access.isVerified,
    latestScan: latestScan ? publicScan(latestScan) : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "scan") {
    return { ok: false as const, error: "Unsupported scan action." };
  }

  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified) {
    return {
      ok: false as const,
      error:
        "Shopify billing has not been verified. Scanning remains locked until verification succeeds.",
    };
  }
  if (!access.hasActiveSubscription) {
    return {
      ok: false as const,
      error:
        "An active Shopify subscription is required before starting a scan.",
    };
  }

  try {
    const storefrontResponse = await admin.graphql(`#graphql
      query StorefrontScanTarget {
        shop { primaryDomain { url } }
      }
    `);
    const storefrontResult = await storefrontResponse.json();
    const storefrontUrl = storefrontResult.data?.shop?.primaryDomain?.url;
    if (typeof storefrontUrl !== "string") {
      throw new Error("Shopify did not return a primary storefront URL.");
    }

    const scan = await runStorefrontScan(session.shop, storefrontUrl);
    return { ok: true as const, scan: publicScan(scan) };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "The scan could not be completed. Please retry.",
    };
  }
};

function displayMs(value: number | null) {
  if (value === null) return "Not available";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

export default function ScanPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const scan = actionData?.ok ? actionData.scan : data.latestScan;
  const findings = scan?.findings ?? [];

  return (
    <s-page heading="Storefront scan">
      <main className="pp-scanPage">
        <section className="pp-scanHero">
          <div>
            <p className="pp-eyebrow">Real storefront measurement</p>
            <h1>Find what is slowing the mobile storefront.</h1>
            <p>
              Run a mobile Lighthouse scan against your authenticated
              myshopify.com storefront. Scores and recommendations come from
              Google PageSpeed Insights; they are synthetic lab data, not
              visitors&apos; field experience or a promise of improvement.
            </p>
          </div>
          <form method="post">
            <input type="hidden" name="intent" value="scan" />
            <button
              className="pp-scanButton"
              type="submit"
              disabled={!data.canScan || busy}
            >
              {busy ? "Scanning storefront…" : "Run mobile scan"}
            </button>
          </form>
        </section>

        {!data.canScan ? (
          <aside className="pp-scanNotice" role="status">
            {!data.subscriptionVerified
              ? "Subscription status is not verified with Shopify. Scanning is locked until Partner API billing verification is configured."
              : "An active Shopify subscription is required to run a scan."}{" "}
            <a href="/app/billing">View billing</a>
          </aside>
        ) : null}

        {actionData && !actionData.ok ? (
          <aside className="pp-scanNotice" role="alert">
            {actionData.error}
          </aside>
        ) : null}

        {scan ? (
          <>
            <section
              className="pp-scanPanel"
              aria-labelledby="scan-result-heading"
            >
              <div className="pp-scanPanelHeader">
                <div>
                  <h2 id="scan-result-heading">Latest mobile scan</h2>
                  <p>
                    {new Date(scan.createdAt).toLocaleString()} · {scan.pageUrl}
                  </p>
                </div>
                <span
                  className={`pp-scanStatus pp-scanStatus-${scan.status.toLowerCase()}`}
                >
                  {scan.status === "COMPLETE"
                    ? "Complete · synthetic lab data"
                    : scan.status}
                </span>
              </div>

              {scan.status === "COMPLETE" ? (
                <>
                  <div className="pp-scanMetrics">
                    <article>
                      <span>Performance score</span>
                      <strong>
                        {scan.performance ?? "—"}
                        <small>/100</small>
                      </strong>
                      <p>Mobile Lighthouse lab score</p>
                    </article>
                    <article>
                      <span>Largest Contentful Paint</span>
                      <strong>{displayMs(scan.lcpMs)}</strong>
                      <p>Synthetic lab metric</p>
                    </article>
                    <article>
                      <span>Total Blocking Time</span>
                      <strong>{displayMs(scan.tbtMs)}</strong>
                      <p>Lab diagnostic; not INP</p>
                    </article>
                    <article>
                      <span>Cumulative Layout Shift</span>
                      <strong>
                        {scan.cls === null
                          ? "Not available"
                          : scan.cls.toFixed(3)}
                      </strong>
                      <p>Synthetic lab metric</p>
                    </article>
                  </div>
                  <p className="pp-scanFootnote">
                    Field Core Web Vitals are not included in this result.
                    Lighthouse Total Blocking Time is not a substitute for field
                    INP. Retest after making changes; no changes have been
                    applied automatically.
                  </p>
                  <h3>Opportunities to investigate</h3>
                  {findings.length ? (
                    <ul className="pp-scanFindings">
                      {findings.map((finding) => (
                        <li key={finding.id}>
                          <strong>{finding.title}</strong>
                          {finding.displayValue ? (
                            <span>{finding.displayValue}</span>
                          ) : null}
                          <p>{finding.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No flagged opportunities were returned by Lighthouse for
                      this run.
                    </p>
                  )}
                </>
              ) : (
                <p role="status">
                  {scan.error || "The latest scan did not complete."}
                </p>
              )}
            </section>
          </>
        ) : (
          <section className="pp-scanPanel">
            <h2>No scan results yet</h2>
            <p>
              Start a real mobile scan above. The scan may take up to a minute;
              keep this app page open while Google PageSpeed measures the
              storefront.
            </p>
          </section>
        )}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
