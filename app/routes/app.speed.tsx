import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFetcher, useLoaderData, Link } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { getEmbedStatus } from "../optimization/embed-status.server";
import { DeferredEmbedStatus, EmbedBanner, embedBadge, embedDetail } from "../components/embed-status";
import { Icon, type IconName } from "../components/icons";
import { Badge, Banner, Card, PageHeader, Spinner, Time } from "../components/ui";
import {
  DEFAULT_SPEED_SETTINGS,
  KNOWN_TRACKER_PATTERNS,
  enabledCount,
  parseSpeedSettings,
  type SpeedBooleanKey,
  type SpeedSettings,
} from "../optimization/speed-settings";
import { loadSpeedSettings, saveSpeedSettings } from "../optimization/speed-settings.server";
import { themeEditorEmbedUrl } from "../optimization/theme-editor";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // The theme check is streamed: the page renders without waiting for it.
  const embed = getEmbedStatus(admin, session.shop);
  const [access, stored] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    loadSpeedSettings(admin).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Could not load settings.",
    })),
  ]);
  const loadError = "error" in stored ? stored.error : null;
  return {
    canEdit: access.isVerified && access.hasActiveSubscription,
    subscriptionVerified: access.isVerified,
    settings: "settings" in stored ? stored.settings : DEFAULT_SPEED_SETTINGS,
    updatedAt: "settings" in stored ? stored.updatedAt : null,
    loadError,
    embedUrl: themeEditorEmbedUrl(session.shop),
    embed,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified || !access.hasActiveSubscription) {
    return { ok: false as const, error: "An active, verified subscription is required to change speed boosters." };
  }
  try {
    const form = await request.formData();
    const raw = form.get("settings");
    if (typeof raw !== "string" || raw.length > 20_000) throw new Error("Invalid settings payload.");
    const settings = parseSpeedSettings(JSON.parse(raw));
    const { installationId } = await loadSpeedSettings(admin);
    const updatedAt = await saveSpeedSettings(admin, installationId, settings);
    return { ok: true as const, settings, updatedAt };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Settings could not be saved." };
  }
};

type Impact = "LCP" | "FCP" | "TBT" | "INP" | "CLS" | "Speed Index";

type BoosterDef = {
  key: SpeedBooleanKey;
  icon: IconName;
  title: string;
  description: string;
  impacts: Impact[];
  caution?: string;
  advanced?: boolean;
  extra?: (settings: SpeedSettings, update: (patch: Partial<SpeedSettings>) => void, disabled: boolean) => ReactNode;
};

const GROUPS: Array<{ id: string; icon: IconName; title: string; subtitle: string; boosters: BoosterDef[]; links?: Array<{ href: string; label: string; text: string }> }> = [
  {
    id: "scripts",
    icon: "code",
    title: "JavaScript & apps",
    subtitle: "Third-party scripts are the most common reason Shopify stores score poorly on mobile.",
    boosters: [
      {
        key: "delayAppScripts",
        icon: "layers",
        title: "Optimize Shopify apps",
        description:
          "Holds scripts that apps inject from their own servers until the visitor first scrolls, taps, moves the mouse or presses a key. Checkout, payment, consent and Shopify scripts are never delayed.",
        impacts: ["TBT", "LCP", "INP"],
        caution: "App widgets (chat, reviews, pop-ups) appear after the first interaction instead of on load.",
      },
      {
        key: "delayTrackers",
        icon: "cursor",
        title: "Defer tracking & chat until user action",
        description: `Delays well-known analytics, ad pixels and chat widgets (${KNOWN_TRACKER_PATTERNS.slice(0, 5).join(", ")} and ${KNOWN_TRACKER_PATTERNS.length - 5} more) until the first interaction. Shopify's own customer events (Web Pixels) are unaffected.`,
        impacts: ["TBT", "INP", "FCP"],
        caution: "Visits that leave without interacting are not reported to those third-party tools.",
      },
      {
        key: "passiveListeners",
        icon: "timer",
        title: "Improve interaction responsiveness",
        description:
          "Marks touch and wheel listeners as passive so scrolling and taps never wait for JavaScript. Reduces input delay, which feeds Interaction to Next Paint.",
        impacts: ["INP"],
        caution: "Test swipe galleries on a phone: a slider that blocks page scrolling while swiping may scroll the page as well.",
      },
    ],
    links: [{ href: "/app/optimize", label: "Minify recommendations", text: "See which theme CSS and JavaScript files can be smaller, with a copy-ready minified version and steps." }],
  },
  {
    id: "media",
    icon: "image",
    title: "Images & media",
    subtitle: "Make the main image arrive sooner and stop heavy embeds from competing with it.",
    boosters: [
      {
        key: "preloadLcp",
        icon: "image",
        title: "Preload Largest Contentful Paint image",
        description:
          "On product pages, tells the browser to fetch the featured product image at high priority from the <head>, before the theme's markup is parsed.",
        impacts: ["LCP"],
        caution: "If an audit later reports the product image downloaded twice, adjust “LCP image sizes” in Advanced or turn this off.",
      },
      {
        key: "lazyMedia",
        icon: "film",
        title: "Lazy-load videos & embeds",
        description:
          "YouTube, Vimeo, Wistia, Loom, TikTok, Instagram and Google Maps embeds, including those inside product descriptions, load only when scrolled near. Non-autoplay videos stop preloading.",
        impacts: ["LCP", "TBT", "Speed Index"],
      },
    ],
    links: [{ href: "/app/optimize", label: "Lazy-load recommendations", text: "See theme images and embeds that load too early, with the exact code change for each." }],
  },
  {
    id: "rendering",
    icon: "font",
    title: "Fonts & rendering",
    subtitle: "Get text on screen sooner and keep the layout steady while the page loads.",
    boosters: [
      {
        key: "fontOptimization",
        icon: "font",
        title: "Optimize fonts",
        description:
          "Opens the connection to Shopify's font CDN early and preloads your theme's body and heading fonts, so text renders in the right typeface without a late swap.",
        impacts: ["FCP", "LCP", "CLS"],
      },
      {
        key: "pageStabilizer",
        icon: "stack",
        title: "Page stabilizer",
        description:
          "Reserves space for images and video embeds inside rich-text content such as product descriptions, and stops the page shifting sideways when a scrollbar appears.",
        impacts: ["CLS"],
      },
      {
        key: "lazySections",
        icon: "layers",
        title: "Defer offscreen section rendering",
        description:
          "Uses CSS content-visibility so the browser skips layout and paint for sections far below the fold until they are scrolled near.",
        impacts: ["Speed Index", "INP"],
        caution: "Experimental: check anchors, sticky elements and in-page links before keeping it on.",
        advanced: true,
      },
    ],
  },
  {
    id: "navigation",
    icon: "bolt",
    title: "Navigation",
    subtitle: "Make the next page feel instant.",
    boosters: [
      {
        key: "instantPage",
        icon: "bolt",
        title: "Preload pages visitors are about to visit",
        description:
          "Uses the browser's Speculation Rules API to prefetch store pages when a visitor hovers or touches a link. Cart, checkout, account and app pages are excluded.",
        impacts: ["LCP", "FCP"],
        extra: (settings, update, disabled) => (
          <div className="sb-field">
            <label className="sb-label" htmlFor="instantPageMode">Prefetch trigger</label>
            <select id="instantPageMode" className="sb-select" disabled={disabled} value={settings.instantPageMode} onChange={(event) => update({ instantPageMode: event.target.value === "viewport" ? "viewport" : "hover" })}>
              <option value="hover">On hover or touch (recommended)</option>
              <option value="viewport">As soon as links are visible (more data use)</option>
            </select>
          </div>
        ),
      },
      {
        key: "loadingBar",
        icon: "timer",
        title: "Loading bar",
        description: "Shows a slim progress bar at the top of the page as soon as a visitor clicks a link, so navigation feels responsive.",
        impacts: [],
        extra: (settings, update, disabled) => (
          <div className="sb-field">
            <label className="sb-label" htmlFor="loadingBarColor">Bar colour</label>
            <div className="sb-colorInput">
              <input id="loadingBarColor" type="color" disabled={disabled} value={settings.loadingBarColor} onChange={(event) => update({ loadingBarColor: event.target.value })} />
              <input className="sb-input" style={{ maxWidth: 130, fontFamily: "var(--sb-mono)" }} disabled={disabled} value={settings.loadingBarColor} onChange={(event) => update({ loadingBarColor: event.target.value })} aria-label="Bar colour hex value" />
            </div>
          </div>
        ),
      },
    ],
  },
];

function patternLines(text: string) {
  const lines = text.split(/[\n,]/).map((line) => line.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(lines));
}

function Switch({ id, checked, disabled, onChange, label }: { id: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="sb-switch">
      <input id={id} type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" />
    </span>
  );
}

export default function SpeedBoostersPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  // After a save the fetcher result is authoritative until the loader revalidates.
  const saved: SpeedSettings = fetcher.data?.ok ? fetcher.data.settings : data.settings;
  const [settings, setSettings] = useState<SpeedSettings>(data.settings);
  const [delayText, setDelayText] = useState(data.settings.delayPatterns.join("\n"));
  const [neverText, setNeverText] = useState(data.settings.neverDelayPatterns.join("\n"));
  const saving = fetcher.state !== "idle";
  const disabled = !data.canEdit || saving;

  const draft = useMemo(
    () => ({
      ...settings,
      delayPatterns: patternLines(delayText),
      neverDelayPatterns: patternLines(neverText),
    }),
    [settings, delayText, neverText],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (patch: Partial<SpeedSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const save = () => fetcher.submit({ settings: JSON.stringify(draft) }, { method: "post" });
  const discard = () => {
    setSettings(saved);
    setDelayText(saved.delayPatterns.join("\n"));
    setNeverText(saved.neverDelayPatterns.join("\n"));
  };
  const active = enabledCount(saved);

  return (
    <s-page heading="Speed boosters">
      <main className="sb-app">
        <PageHeader
          icon="bolt"
          eyebrow="Storefront optimizations"
          title="Speed boosters"
          description="Optimizations that run through the SpeedBoost app embed. Your theme files stay untouched, and turning a booster off undoes it immediately."
          actions={
            <>
              <a className="sb-btn sb-btn-secondary" href={data.embedUrl} target="_top">
                <Icon name="layers" size={16} />Theme app embed
              </a>
              <Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="gauge" size={16} />Measure impact</Link>
            </>
          }
        />

        <div className="sb-stats">
          <div className="sb-stat">
            <span><Icon name="layers" size={15} />App embed</span>
            <DeferredEmbedStatus status={data.embed}>
              {(status) => (
                <>
                  <strong style={{ fontSize: 16, paddingTop: 4 }}>{embedBadge(status)}</strong>
                  <small>{embedDetail(status)}</small>
                </>
              )}
            </DeferredEmbedStatus>
          </div>
          <div className="sb-stat">
            <span><Icon name="bolt" size={15} />Boosters on</span>
            <strong className="sb-num">{active}</strong>
            <small>of {GROUPS.reduce((sum, group) => sum + group.boosters.length, 0)} available</small>
          </div>
          <div className="sb-stat">
            <span><Icon name="clock" size={15} />Last saved</span>
            <strong style={{ fontSize: 16, paddingTop: 4 }}><Time value={data.updatedAt} relative /></strong>
            <small>Applies on the next page view</small>
          </div>
          <div className="sb-stat">
            <span><Icon name="shield" size={15} />Rollback</span>
            <strong style={{ fontSize: 16, paddingTop: 4 }}>Instant</strong>
            <small>Toggle off or disable the embed</small>
          </div>
        </div>

        <DeferredEmbedStatus status={data.embed}>
          {(status) => <EmbedBanner status={status} embedUrl={data.embedUrl} />}
        </DeferredEmbedStatus>
        {!data.canEdit ? (
          <Banner tone="warning" title="Boosters are locked">
            {data.subscriptionVerified ? "An active subscription is required." : "Subscription status is not verified yet."}{" "}
            <Link to="/app/billing">View billing</Link>
          </Banner>
        ) : null}
        {data.loadError ? <Banner tone="critical" title="Saved settings could not be loaded">{data.loadError}</Banner> : null}
        {fetcher.data && !fetcher.data.ok ? <Banner tone="critical" title="Not saved">{fetcher.data.error}</Banner> : null}
        {fetcher.state === "idle" && fetcher.data?.ok && !dirty ? (
          <Banner tone="success" title="Speed boosters saved">
            Changes are live on your storefront&apos;s next page view. <Link to="/app/scan">Run an audit</Link> to measure the effect.
          </Banner>
        ) : null}

        {GROUPS.map((group) => (
          <Card key={group.id} icon={group.icon} title={group.title} subtitle={group.subtitle}>
            <ul className="sb-toggleList">
              {group.boosters.map((booster) => {
                const id = `booster-${booster.key}`;
                const on = settings[booster.key];
                return (
                  <li className="sb-toggle" key={booster.key}>
                    <span className={`sb-listIcon ${on ? "sb-listIcon-done" : ""}`}><Icon name={booster.icon} size={18} /></span>
                    <div className="sb-toggleText">
                      <label htmlFor={id}>
                        {booster.title}
                        {booster.advanced ? <Badge tone="neutral">Advanced</Badge> : null}
                        {booster.impacts.map((impact) => <span className="sb-chip" key={impact}>{impact}</span>)}
                      </label>
                      <p>{booster.description}</p>
                      {booster.caution ? (
                        <p className="sb-help" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                          <Icon name="info" size={14} style={{ flex: "0 0 auto", marginTop: 2 }} />
                          {booster.caution}
                        </p>
                      ) : null}
                      {booster.extra && on ? <div className="sb-toggleExtra">{booster.extra(settings, update, disabled)}</div> : null}
                    </div>
                    <Switch id={id} label={booster.title} checked={on} disabled={disabled} onChange={(value) => update({ [booster.key]: value } as Partial<SpeedSettings>)} />
                  </li>
                );
              })}
              {group.links?.map((link) => (
                <li className="sb-toggle" key={link.label}>
                  <span className="sb-listIcon"><Icon name="code" size={18} /></span>
                  <div className="sb-toggleText">
                    <strong>{link.label}</strong>
                    <p>{link.text}</p>
                  </div>
                  <Link className="sb-btn sb-btn-secondary" to={link.href}>View recommendations <Icon name="arrowRight" size={14} /></Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}

        <Card icon="settings" title="Advanced options" subtitle="For developers. Patterns match any part of a script URL, one per line.">
          <div className="sb-grid sb-grid-2">
            <div className="sb-field">
              <label className="sb-label" htmlFor="delayPatterns">Also delay these scripts</label>
              <textarea id="delayPatterns" className="sb-textarea" disabled={disabled} value={delayText} onChange={(event) => setDelayText(event.target.value)} placeholder={"widget.example.com\ncdn.example.com/popup.js"} />
              <span className="sb-help">Applies when either script booster is on.</span>
            </div>
            <div className="sb-field">
              <label className="sb-label" htmlFor="neverDelayPatterns">Never delay these scripts</label>
              <textarea id="neverDelayPatterns" className="sb-textarea" disabled={disabled} value={neverText} onChange={(event) => setNeverText(event.target.value)} placeholder={"reviews.example.com\nsubscriptions-app.com"} />
              <span className="sb-help">Use this to exclude an app that must load immediately.</span>
            </div>
            <div className="sb-field">
              <label className="sb-label" htmlFor="delayTimeoutMs">Load delayed scripts anyway after</label>
              <select id="delayTimeoutMs" className="sb-select" disabled={disabled} value={settings.delayTimeoutMs} onChange={(event) => update({ delayTimeoutMs: Number(event.target.value) })}>
                <option value={0}>Never: wait for interaction (fastest)</option>
                <option value={3000}>3 seconds after page load</option>
                <option value={5000}>5 seconds after page load</option>
                <option value={10000}>10 seconds after page load</option>
              </select>
              <span className="sb-help">A fallback so analytics still record visitors who never interact.</span>
            </div>
            <div className="sb-field">
              <label className="sb-label" htmlFor="lcpImageSizes">LCP image sizes</label>
              <input id="lcpImageSizes" className="sb-input" disabled={disabled} value={settings.lcpImageSizes} onChange={(event) => update({ lcpImageSizes: event.target.value })} style={{ fontFamily: "var(--sb-mono)", fontSize: 13 }} />
              <span className="sb-help">Must match your theme&apos;s product image <code>sizes</code> so the preload and the image are the same file.</span>
            </div>
          </div>
        </Card>

        {dirty ? (
          <div className="sb-saveBar" role="region" aria-label="Unsaved changes">
            <strong>Unsaved changes</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="sb-btn sb-btn-secondary" onClick={discard} disabled={saving}>Discard</button>
              <button type="button" className="sb-btn sb-btn-accent" onClick={save} disabled={disabled}>
                {saving ? <><Spinner /> Saving…</> : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
