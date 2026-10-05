import { useActionData, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import prisma from "../db.server";
import type { CruxFieldMetrics } from "../performance/field-data";
import {
  normalizeTargetPath,
  parseStrategies,
} from "../performance/scan-targets";
import {
  publicAudit,
  publicScan,
  runStorefrontScan,
} from "../performance/scan.server";

const MAX_AUDITS_PER_HOUR = 3;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [access, latestAudit, legacyScan] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    prisma.auditRun.findFirst({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      include: { scans: { orderBy: { strategy: "asc" } } },
    }),
    prisma.performanceScan.findFirst({
      where: { shop: session.shop, auditRunId: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    canScan: access.isVerified && access.hasActiveSubscription,
    subscriptionVerified: access.isVerified,
    latestAudit: latestAudit ? publicAudit(latestAudit) : null,
    legacyScan: legacyScan ? publicScan(legacyScan) : null,
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
        "Shopify billing has not been verified. Auditing remains locked until verification succeeds.",
    };
  }
  if (!access.hasActiveSubscription) {
    return {
      ok: false as const,
      error:
        "An active Shopify subscription is required before starting an audit.",
    };
  }

  try {
    const target = normalizeTargetPath(form.get("targetPath") ?? "/");
    const strategies = parseStrategies(form.get("strategy"));
    const storefrontResponse = await admin.graphql(`#graphql
      query StorefrontAuditTarget {
        shop { primaryDomain { url } }
      }
    `);
    const storefrontResult = await storefrontResponse.json();
    const primaryOrigin = storefrontResult.data?.shop?.primaryDomain?.url;
    if (typeof primaryOrigin !== "string") {
      throw new Error("Shopify did not return a primary storefront URL.");
    }

    const pageUrl = new URL(target.targetPath, primaryOrigin).toString();
    const audit = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Serialize quota checks per shop so concurrent form submissions cannot
        // all pass the same count check.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.shop}, 0))`;
        const since = new Date(Date.now() - 60 * 60 * 1000);
        const runsInWindow = await tx.auditRun.count({
          where: { shop: session.shop, createdAt: { gte: since } },
        });
        if (runsInWindow >= MAX_AUDITS_PER_HOUR) {
          throw new Error(
            "Audit limit reached: up to three audit runs per store each hour.",
          );
        }
        return tx.auditRun.create({
          data: {
            shop: session.shop,
            targetPath: target.targetPath,
            pageUrl,
            template: target.template,
            strategies,
            status: "RUNNING",
          },
        });
      },
    );

    await Promise.allSettled(
      strategies.map((strategy) =>
        runStorefrontScan(
          session.shop,
          primaryOrigin,
          target.targetPath,
          strategy,
          audit.id,
        ),
      ),
    );

    const scans = (await prisma.performanceScan.findMany({
      where: { shop: session.shop, auditRunId: audit.id },
      orderBy: { strategy: "asc" },
    })) as Array<Parameters<typeof publicScan>[0]>;
    const completedCount = scans.filter(
      (scan) => scan.status === "COMPLETE",
    ).length;
    const status =
      completedCount === strategies.length
        ? "COMPLETE"
        : completedCount > 0
          ? "PARTIAL"
          : "FAILED";
    const error =
      status === "COMPLETE"
        ? null
        : scans
            .filter((scan) => scan.status === "FAILED" && scan.error)
            .map((scan) => `${scan.strategy}: ${scan.error}`)
            .join(" ") || "No requested Lighthouse run completed.";
    const updatedAudit = await prisma.auditRun.update({
      where: { id: audit.id },
      data: { status, error, completedAt: new Date() },
      include: { scans: { orderBy: { strategy: "asc" } } },
    });
    return {
      ok: status !== "FAILED",
      error,
      audit: publicAudit(updatedAudit),
    } as const;
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "The audit could not be completed. Please retry.",
    };
  }
};

function displayMs(value: number | undefined | null) {
  if (value === null || value === undefined) return "Not available";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function fieldCategory(value: string | undefined) {
  if (value === "FAST") return "Good";
  if (value === "AVERAGE") return "Needs improvement";
  if (value === "SLOW") return "Poor";
  return "Not classified";
}

export default function ScanPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const audit = actionData?.audit ?? data.latestAudit;
  const scanRows = audit?.scans ?? (data.legacyScan ? [data.legacyScan] : []);

  return (
    <s-page heading="Speed Audit">
      <main className="pp-scanPage">
        <section className="pp-scanHero">
          <div>
            <p className="pp-eyebrow">Real storefront measurement</p>
            <h1>Audit a storefront page on mobile and desktop.</h1>
            <p>
              Choose the homepage or enter a Shopify page path such as
              /products/handle or /collections/handle. The path is scanned only
              on the authenticated shop&apos;s primary domain. Google PageSpeed
              Insights supplies synthetic Lighthouse data; it is not a field
              measurement or promise of improved rankings or sales.
            </p>
          </div>
          <form method="post" className="pp-auditForm">
            <input type="hidden" name="intent" value="scan" />
            <label>
              Storefront path
              <input
                name="targetPath"
                type="text"
                defaultValue="/"
                maxLength={250}
                autoComplete="off"
                spellCheck={false}
                placeholder="/products/handle"
                required
              />
            </label>
            <label>
              Device
              <select name="strategy" defaultValue="mobile">
                <option value="mobile">Mobile</option>
                <option value="desktop">Desktop</option>
                <option value="both">Mobile + desktop</option>
              </select>
            </label>
            <button
              className="pp-scanButton"
              type="submit"
              disabled={!data.canScan || busy}
            >
              {busy ? "Auditing… keep this page open" : "Run audit"}
            </button>
          </form>
        </section>

        {!data.canScan ? (
          <aside className="pp-scanNotice" role="status">
            {!data.subscriptionVerified
              ? "Subscription status is not verified with Shopify. Auditing remains locked until Partner API billing verification is configured."
              : "An active Shopify subscription is required to run an audit."}{" "}
            <a href="/app/billing">View billing</a>
          </aside>
        ) : null}

        {actionData && !actionData.ok && !actionData.audit ? (
          <aside className="pp-scanNotice" role="alert">
            {actionData.error}
          </aside>
        ) : null}

        {audit ? (
          <section
            className="pp-scanPanel"
            aria-labelledby="scan-result-heading"
          >
            <div className="pp-scanPanelHeader">
              <div>
                <h2 id="scan-result-heading">
                  Latest audit · {audit.template}
                </h2>
                <p>
                  {new Date(audit.createdAt).toLocaleString()} · {audit.pageUrl}
                </p>
              </div>
              <span
                className={`pp-scanStatus pp-scanStatus-${audit.status.toLowerCase()}`}
              >
                {audit.status}
              </span>
            </div>
            {actionData?.audit && actionData.audit.status !== "COMPLETE" ? (
              <aside className="pp-scanNotice" role="status">
                {actionData.error ||
                  audit.error ||
                  "One or more strategies did not complete."}
              </aside>
            ) : null}
            <div className="pp-auditResults">
              {scanRows.map((scan) => {
                const field = scan.fieldData as CruxFieldMetrics | undefined;
                return (
                  <article className="pp-auditResult" key={scan.id}>
                    <div className="pp-scanPanelHeader">
                      <div>
                        <h3>
                          {scan.strategy === "mobile" ? "Mobile" : "Desktop"}{" "}
                          Lighthouse
                        </h3>
                        <p>
                          {scan.status === "COMPLETE"
                            ? "Synthetic lab data"
                            : scan.error || scan.status}
                        </p>
                      </div>
                      {scan.status === "COMPLETE" ? (
                        <span className="pp-scanStatus pp-scanStatus-complete">
                          Score {scan.performance ?? "—"}/100
                        </span>
                      ) : null}
                    </div>
                    {scan.status === "COMPLETE" ? (
                      <>
                        <div className="pp-scanMetrics">
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
                          <article>
                            <span>First Contentful Paint</span>
                            <strong>{displayMs(scan.fcpMs)}</strong>
                            <p>Synthetic lab metric</p>
                          </article>
                        </div>
                        <h4>Opportunities to investigate</h4>
                        {scan.findings.length ? (
                          <ul className="pp-scanFindings">
                            {scan.findings.map((finding) => (
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
                            No flagged opportunities were returned for this run.
                          </p>
                        )}
                        <div className="pp-cruxPanel">
                          <h4>Field Core Web Vitals · CrUX</h4>
                          {field && scan.fieldDataSource ? (
                            <>
                              <p>
                                {scan.fieldDataSource === "URL"
                                  ? "This URL"
                                  : "Store origin"}{" "}
                                · provider 75th percentile · aggregated
                                real-user data.
                              </p>
                              <div className="pp-cruxGrid">
                                {[
                                  {
                                    name: "LCP",
                                    value: displayMs(field.lcpP75Ms),
                                    category: fieldCategory(field.lcpCategory),
                                  },
                                  {
                                    name: "INP",
                                    value: displayMs(field.inpP75Ms),
                                    category: fieldCategory(field.inpCategory),
                                  },
                                  {
                                    name: "CLS",
                                    value:
                                      field.clsP75 === undefined
                                        ? "Not available"
                                        : field.clsP75.toFixed(3),
                                    category: fieldCategory(field.clsCategory),
                                  },
                                  {
                                    name: "FCP",
                                    value: displayMs(field.fcpP75Ms),
                                    category: fieldCategory(field.fcpCategory),
                                  },
                                  {
                                    name: "TTFB",
                                    value: displayMs(field.ttfbP75Ms),
                                    category: fieldCategory(field.ttfbCategory),
                                  },
                                ].map((metric) => (
                                  <article key={metric.name}>
                                    <span>{metric.name}</span>
                                    <strong>{metric.value}</strong>
                                    <small>{metric.category}</small>
                                  </article>
                                ))}
                              </div>
                            </>
                          ) : (
                            <p>
                              Google did not return enough CrUX field data for
                              this URL or store origin. Missing values are not
                              estimated.
                            </p>
                          )}
                        </div>
                      </>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <p className="pp-scanFootnote">
              Any available CrUX data is shown separately from Lighthouse lab
              metrics. TBT is not a substitute for field INP. No theme or asset
              changes are made by an audit.
            </p>
          </section>
        ) : data.legacyScan ? (
          <section className="pp-scanPanel">
            <h2>Earlier mobile homepage audit</h2>
            <p>
              {data.legacyScan.pageUrl} · Score{" "}
              {data.legacyScan.performance ?? "—"}/100
            </p>
          </section>
        ) : (
          <section className="pp-scanPanel">
            <h2>No audit results yet</h2>
            <p>
              Start a real audit above. Google PageSpeed can take up to a minute
              per device; keep this page open. You can run at most three audits
              per store each hour.
            </p>
          </section>
        )}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
