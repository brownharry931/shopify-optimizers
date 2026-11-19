export type FindingGuidance = {
  area: string;
  nextStep: string;
  automation: string;
};

const guidanceByAuditId: Record<string, FindingGuidance> = {
  "render-blocking-resources": {
    area: "Stylesheets and scripts",
    nextStep:
      "Review the exact resources and their dependencies before changing load order. Deferring CSS can cause unstyled content; delaying scripts can break cart, consent, analytics, or app features.",
    automation:
      "The Optimization Center can preview CSS/JavaScript minification and defer a limited set of static first-party theme scripts on an unpublished/development theme. No storefront change was made by this audit.",
  },
  "unused-css-rules": {
    area: "CSS",
    nextStep:
      "Treat this as a page-and-state-specific clue, not proof that a stylesheet is safe to delete. Check menus, variants, cart, responsive layouts, and app blocks before removal.",
    automation:
      "CSS minification is available as a draft-theme preview, but unused CSS is not deleted automatically; one Lighthouse page cannot prove a rule is unused across all pages and states.",
  },
  "unused-javascript": {
    area: "JavaScript",
    nextStep:
      "Identify the script owner and test all storefront interactions before changing it. One Lighthouse page load cannot establish that code is unused on every page or state.",
    automation:
      "Speed boosters → Optimize Shopify apps and Defer tracking & chat hold third-party scripts until the first interaction. The Theme optimizer can add `defer` to compatible static theme scripts on a draft theme.",
  },
  "uses-optimized-images": {
    area: "Images",
    nextStep:
      "Inspect the image candidates, their rendered dimensions, and whether each is above the fold before choosing a responsive Shopify CDN variant.",
    automation:
      "The Optimization Center can inspect selected Liquid sections/snippets and preview lazy loading for files you confirm are below the fold. It does not change image files or infer whether an image is above the fold.",
  },
  "modern-image-formats": {
    area: "Images",
    nextStep:
      "Confirm source format, Shopify CDN support, browser delivery, and image quality before selecting a modern format.",
    automation:
      "No image conversion or replacement is performed by this audit.",
  },
  "uses-responsive-images": {
    area: "Images",
    nextStep:
      "Compare rendered image size with the viewport and preserve existing `srcset`, `sizes`, aspect ratio, and gallery behavior.",
    automation:
      "The Optimization Center can preview loading hints for selected Shopify `image_tag` expressions; it does not resize or convert image files and does not rewrite raw `<img>` markup.",
  },
  "largest-contentful-paint-element": {
    area: "LCP resource",
    nextStep:
      "Verify that the reported element is the intended hero or product image on both mobile and desktop before prioritizing it.",
    automation:
      "The Optimization Center can preview eager loading and high fetch priority for one exact Shopify `image_tag` expression after you verify it is the LCP element; the audit itself makes no theme change.",
  },
  "lcp-discovery": {
    area: "LCP resource discovery",
    nextStep:
      "Check whether the LCP image is discoverable in the initial document and whether lazy loading or script insertion delays it.",
    automation:
      "On product pages, Speed boosters → Preload LCP image fetches the featured image from the <head> at high priority. Elsewhere, the Theme optimizer can set eager loading and high fetch priority on the exact Shopify `image_tag` you identify.",
  },
  "font-display": {
    area: "Fonts",
    nextStep:
      "Check font format, weights, cross-origin behavior, and layout impact before changing font-display or adding preload hints.",
    automation:
      "Speed boosters → Optimize fonts preconnects to Shopify's font CDN and preloads the theme's body and heading fonts. It cannot change a theme's own font-display value.",
  },
  "uses-text-compression": {
    area: "Hosting and delivery",
    nextStep:
      "Check the response and Shopify/CDN delivery path; compression is controlled by the serving platform, not by changing the source file.",
    automation: "The app cannot change Shopify's server-side compression behavior.",
  },
  "uses-long-cache-ttl": {
    area: "Caching",
    nextStep:
      "Check which response is affected and whether its URL is versioned; do not assume the app controls Shopify CDN cache headers.",
    automation: "The app does not change Shopify CDN or browser cache policy.",
  },
};

// Lighthouse 12 "insight" audits replace several legacy audit ids.
const insightAliases: Record<string, string> = {
  "render-blocking-insight": "render-blocking-resources",
  "image-delivery-insight": "uses-optimized-images",
  "lcp-discovery-insight": "lcp-discovery",
  "lcp-phases-insight": "largest-contentful-paint-element",
  "font-display-insight": "font-display",
  "cache-insight": "uses-long-cache-ttl",
  "document-latency-insight": "uses-text-compression",
  "legacy-javascript-insight": "unused-javascript",
  "duplicated-javascript-insight": "unused-javascript",
  "legacy-javascript": "unused-javascript",
  "bootup-time": "unused-javascript",
  "mainthread-work-breakdown": "unused-javascript",
  "offscreen-images": "uses-optimized-images",
  "unminified-css": "unused-css-rules",
};

const extraGuidance: Record<string, FindingGuidance> = {
  "third-parties-insight": {
    area: "Third-party code",
    nextStep:
      "Identify which apps and tags in the table are not needed for the first paint. Most analytics, chat and pop-up scripts can wait until the visitor interacts.",
    automation:
      "Turn on Speed boosters → Optimize Shopify apps and Defer tracking & chat. Use Advanced options to add or exclude specific script URLs.",
  },
  "third-party-summary": {
    area: "Third-party code",
    nextStep:
      "Identify which apps and tags in the table are not needed for the first paint. Most analytics, chat and pop-up scripts can wait until the visitor interacts.",
    automation:
      "Turn on Speed boosters → Optimize Shopify apps and Defer tracking & chat. Use Advanced options to add or exclude specific script URLs.",
  },
  "cls-culprits-insight": {
    area: "Layout stability",
    nextStep:
      "Give images, embeds and app widgets explicit dimensions or reserved space, and avoid injecting banners above existing content after load.",
    automation:
      "Speed boosters → Page stabilizer reserves space for images and embeds in rich-text content. Optimize fonts reduces late font swaps.",
  },
  "unminified-javascript": {
    area: "JavaScript",
    nextStep: "Minify the listed theme scripts. App-hosted files must be fixed by the app vendor.",
    automation: "The Theme optimizer minifies theme .js assets on a draft theme with checksum-protected rollback.",
  },
  "network-dependency-tree-insight": {
    area: "Request chains",
    nextStep:
      "Shorten chains of critical requests: preconnect to required origins and avoid loading CSS or fonts through other CSS files.",
    automation: "Speed boosters → Optimize fonts preconnects to Shopify's font CDN. Other chains need theme changes.",
  },
  "dom-size-insight": {
    area: "DOM size",
    nextStep:
      "Reduce the number of elements on the page, for example long mega-menus, hidden product variants or very large collections rendered at once.",
    automation: "Speed boosters → Defer offscreen section rendering can reduce rendering cost; the DOM itself needs theme changes.",
  },
};

export function guidanceForFinding(id: string): FindingGuidance {
  return (
    extraGuidance[id] ??
    guidanceByAuditId[insightAliases[id] ?? id] ?? {
      area: "Storefront diagnostic",
      nextStep:
        "Review the provider's finding and affected resource details. Validate any change on mobile and desktop before publishing.",
      automation: "No automatic storefront change is applied from an audit finding.",
    }
  );
}
