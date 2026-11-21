import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getEmbedStateByTheme, type ThemeEmbedRow } from "../optimization/embed-status.server";
import { themeEditorEmbedUrlForTheme } from "../optimization/theme-editor";
import { Icon } from "../components/icons";
import { Badge, Banner, Card, PageHeader, Spinner, Time } from "../components/ui";

/**
 * Merchant onboarding for the SpeedBoost theme app extension (app embed),
 * following https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/ux#merchant-onboarding:
 * theme selection, a deep link that activates the embed, where it renders,
 * how to configure it, how to deactivate it, and illustrated steps.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [themes, heartbeat] = await Promise.all([
    getEmbedStateByTheme(admin).catch(() => null),
    prisma.themeEmbedHeartbeat.findUnique({ where: { shop: session.shop } }),
  ]);
  const rows: Array<ThemeEmbedRow & { editorUrl: string }> = (themes ?? []).map((theme) => ({
    ...theme,
    editorUrl: themeEditorEmbedUrlForTheme(session.shop, theme.id),
  }));
  return {
    themes: rows,
    themesError: themes === null,
    lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null,
  };
};

function stateBadge(state: ThemeEmbedRow["state"]) {
  if (state === "enabled") return <Badge tone="success" icon="check">SpeedBoost on</Badge>;
  if (state === "disabled") return <Badge tone="warning">Turned off</Badge>;
  if (state === "unknown") return <Badge tone="neutral">Couldn&apos;t check</Badge>;
  return <Badge tone="neutral">Not turned on</Badge>;
}

/** Drawn illustration of the theme editor's App embeds panel (not a screenshot). */
function EditorIllustration({ step }: { step: "toggle" | "save" | "off" }) {
  const on = step !== "off";
  return (
    <figure className="sb-illustration">
      <svg viewBox="0 0 520 250" role="img" aria-label={step === "save" ? "Theme editor with the Save button highlighted" : `Theme editor App embeds panel with SpeedBoost switched ${on ? "on" : "off"}`}>
        <rect x="1" y="1" width="518" height="248" rx="10" fill="#fff" stroke="#d6dbe3" />
        <rect x="1" y="1" width="518" height="34" rx="10" fill="#f3f4f6" />
        <rect x="1" y="26" width="518" height="9" fill="#f3f4f6" />
        <text x="16" y="23" fontSize="12" fill="#5e6a7d" fontFamily="Inter, sans-serif">Theme editor</text>
        <rect x="438" y="8" width="66" height="20" rx="6" fill={step === "save" ? "#0b1220" : "#c7cdd8"} />
        <text x="471" y="22" fontSize="11" fill="#fff" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">Save</text>
        {step === "save" ? <rect x="432" y="3" width="78" height="30" rx="9" fill="none" stroke="#1b4dff" strokeWidth="2.5" /> : null}
        <rect x="1" y="35" width="40" height="214" fill="#fafbfc" />
        {[0, 1, 2].map((index) => <rect key={index} x="12" y={50 + index * 30} width="18" height="18" rx="4" fill="#dfe3ea" />)}
        <rect x="10" y="138" width="22" height="22" rx="5" fill="#0b1220" />
        <path d="M17 149h8M21 145v8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="41" y="35" width="190" height="214" fill="#fff" stroke="#eef0f3" />
        <text x="56" y="60" fontSize="12.5" fill="#0b1220" fontFamily="Inter, sans-serif" fontWeight="600">App embeds</text>
        <rect x="54" y="76" width="164" height="24" rx="6" fill="#f3f4f6" />
        <text x="64" y="92" fontSize="10.5" fill="#8a94a6" fontFamily="Inter, sans-serif">Search app embeds</text>
        <rect x="54" y="112" width="164" height="44" rx="8" fill={step === "toggle" ? "#eef2ff" : "#fff"} stroke={step === "toggle" ? "#1b4dff" : "#e3e7ee"} strokeWidth={step === "toggle" ? 2 : 1} />
        <rect x="64" y="124" width="20" height="20" rx="5" fill="#0b1220" />
        <text x="92" y="138" fontSize="11.5" fill="#0b1220" fontFamily="Inter, sans-serif" fontWeight="600">SpeedBoost</text>
        <rect x="178" y="126" width="30" height="16" rx="8" fill={on ? "#0b1220" : "#cdd3dd"} />
        <circle cx={on ? 200 : 186} cy="134" r="6" fill="#fff" />
        <rect x="231" y="35" width="288" height="214" fill="#f7f8fa" />
        <rect x="251" y="55" width="248" height="30" rx="5" fill="#e6e9ef" />
        <rect x="251" y="97" width="248" height="90" rx="6" fill="#dfe3ea" />
        <rect x="251" y="199" width="118" height="34" rx="5" fill="#e6e9ef" />
        <rect x="381" y="199" width="118" height="34" rx="5" fill="#e6e9ef" />
      </svg>
      <figcaption>Illustration. Your theme editor may look slightly different.</figcaption>
    </figure>
  );
}

const RUNS_ON = [
  { icon: "store" as const, title: "Every page of your online store", text: "Home, product, collection, cart, search, blog and content pages. App embeds load once in the page <head>, so no section or template needs editing." },
  { icon: "layers" as const, title: "Any theme", text: "App embeds work with Online Store 2.0 and older (vintage) themes. Nothing is added to your theme's code." },
  { icon: "image" as const, title: "Product pages only", text: "The “Preload LCP image” booster only acts on product pages, where it knows which image is shown first." },
];

export default function SetupGuide() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [themeId, setThemeId] = useState(data.themes[0]?.id ?? "");
  const theme = data.themes.find((item) => item.id === themeId) ?? null;
  const done = theme?.state === "enabled";
  const checking = revalidator.state !== "idle";

  return (
    <s-page heading="Setup guide">
      <main className="sb-app">
        <PageHeader
          icon="checkCircle"
          eyebrow="Get started · about 1 minute"
          title="Turn on SpeedBoost in your theme"
          description="SpeedBoost's speed boosters run from a small app embed in your theme. Turning it on doesn't change your theme's code, and you can turn it off at any time."
        />

        {data.themesError ? (
          <Banner tone="warning" title="Your themes couldn't be read right now">
            You can still follow the steps: open Online Store → Themes → Customize → App embeds.
          </Banner>
        ) : null}

        <Card icon="store" title="Step 1 · Choose your theme" subtitle="Pick the theme you want to speed up. Most stores choose their live theme.">
          {data.themes.length ? (
            <div className="sb-themePicker" role="radiogroup" aria-label="Theme">
              {data.themes.map((item) => (
                <label key={item.id} className="sb-themeOption sb-themeOptionTall" data-selected={item.id === themeId}>
                  <input type="radio" name="theme" checked={item.id === themeId} onChange={() => setThemeId(item.id)} />
                  <span style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <span className="sb-themeName">{item.name}</span>
                    <span>{item.role === "MAIN" ? <Badge tone="info">Live theme</Badge> : <Badge tone="neutral">Draft</Badge>}</span>
                  </span>
                  {stateBadge(item.state)}
                </label>
              ))}
            </div>
          ) : (
            <p className="sb-muted">No themes were found.</p>
          )}
        </Card>

        <Card
          icon="layers"
          title="Step 2 · Turn on the SpeedBoost app embed"
          subtitle={theme ? `In ${theme.name}` : undefined}
          actions={theme ? stateBadge(theme.state) : null}
        >
          <div className="sb-guideStep">
            <ol className="sb-steps-list">
              <li>Click <strong>Open theme editor</strong>. The theme editor opens on the <strong>App embeds</strong> panel with SpeedBoost already switched on.</li>
              <li>Check the <strong>SpeedBoost</strong> switch is on (dark), as in the picture.</li>
              <li>Click <strong>Save</strong> in the top-right corner. The embed is not active until you save.</li>
              <li>Come back to this page and click <strong>Check again</strong>.</li>
            </ol>
            <EditorIllustration step="toggle" />
          </div>
          <div className="sb-cardActions" style={{ marginTop: 14 }}>
            {theme ? (
              <a className="sb-btn sb-btn-primary sb-btn-lg" href={theme.editorUrl} target="_top">
                <Icon name="external" size={16} /> Open theme editor
              </a>
            ) : null}
            <button type="button" className="sb-btn sb-btn-secondary sb-btn-lg" onClick={() => revalidator.revalidate()} disabled={checking}>
              {checking ? <><Spinner /> Checking…</> : <><Icon name="refresh" size={16} /> Check again</>}
            </button>
          </div>
          {done ? (
            <div style={{ marginTop: 14 }}>
              <Banner tone="success" title={`SpeedBoost is on in ${theme?.name}`}>
                {theme?.role === "MAIN"
                  ? data.lastSeenAt
                    ? <>Your storefront last checked in <Time value={data.lastSeenAt} relative />.</>
                    : "It will start working on your storefront's next page view."
                  : "It will run when you publish this theme."}
              </Banner>
            </div>
          ) : null}
        </Card>

        <Card icon="store" title="Step 3 · Where SpeedBoost runs">
          <ul className="sb-list">
            {RUNS_ON.map((item) => (
              <li className="sb-listItem" key={item.title} style={{ gridTemplateColumns: "36px minmax(0, 1fr)" }}>
                <span className="sb-listIcon"><Icon name={item.icon} size={18} /></span>
                <span className="sb-listText"><strong>{item.title}</strong><span>{item.text}</span></span>
              </li>
            ))}
          </ul>
        </Card>

        <Card icon="settings" title="Step 4 · Choose your speed boosters" subtitle="All settings live in SpeedBoost, not in the theme editor, so there's one place to manage them.">
          <ol className="sb-steps-list">
            <li>Open <strong>Speed boosters</strong>.</li>
            <li>Switch on the boosters you want. Each one explains what it does and what to check.</li>
            <li>Click <strong>Save</strong> at the bottom. Changes apply on the next page view.</li>
            <li>Run a <strong>Speed audit</strong> before and after to measure the difference.</li>
          </ol>
          <div className="sb-cardActions" style={{ marginTop: 14 }}>
            <Link className="sb-btn sb-btn-primary" to="/app/speed"><Icon name="bolt" size={16} /> Open Speed boosters</Link>
            <Link className="sb-btn sb-btn-secondary" to="/app/scan"><Icon name="gauge" size={16} /> Run a speed audit</Link>
          </div>
        </Card>

        <Card icon="x" title="Turning SpeedBoost off" subtitle="Everything SpeedBoost does on your storefront can be undone instantly.">
          <div className="sb-guideStep">
            <ol className="sb-steps-list">
              <li>To stop one booster, switch it off in <strong>Speed boosters</strong> and save.</li>
              <li>To stop all of them, open the theme editor (button above), switch <strong>SpeedBoost</strong> off under App embeds and click <strong>Save</strong>.</li>
              <li>If you uninstall SpeedBoost, Shopify removes the app embed from your theme automatically. Nothing is left in your theme code.</li>
            </ol>
            <EditorIllustration step="off" />
          </div>
        </Card>

        <p className="sb-footnote">
          Need help? Contact us through the support details on our Shopify App Store listing. Shopify&apos;s guide:{" "}
          <a href="https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/apps#app-embeds" target="_blank" rel="noreferrer">
            Using app embeds
          </a>.
        </p>
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
