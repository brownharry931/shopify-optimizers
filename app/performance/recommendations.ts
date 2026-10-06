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
      "The CSS/JavaScript minifiers are tested as standalone engines, but they are not yet connected to theme assets. No storefront change was made.",
  },
  "unused-css-rules": {
    area: "CSS",
    nextStep:
      "Treat this as a page-and-state-specific clue, not proof that a stylesheet is safe to delete. Check menus, variants, cart, responsive layouts, and app blocks before removal.",
    automation:
      "Unused CSS is not removed automatically; the app does not yet have a safe theme preview and rollback workflow.",
  },
  "unused-javascript": {
    area: "JavaScript",
    nextStep:
      "Identify the script owner and test all storefront interactions before changing it. One Lighthouse page load cannot establish that code is unused on every page or state.",
    automation:
      "Scripts are not delayed or removed automatically. Dependency and compatibility checks are not yet connected to a theme preview.",
  },
  "uses-optimized-images": {
    area: "Images",
    nextStep:
      "Inspect the image candidates, their rendered dimensions, and whether each is above the fold before choosing a responsive Shopify CDN variant.",
    automation:
      "Image discovery and delivery changes are not yet implemented; original merchant assets have not been changed.",
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
      "Responsive image markup is not rewritten automatically.",
  },
  "largest-contentful-paint-element": {
    area: "LCP resource",
    nextStep:
      "Verify that the reported element is the intended hero or product image on both mobile and desktop before prioritizing it.",
    automation:
      "The audit does not change preload or fetch-priority hints.",
  },
  "lcp-discovery": {
    area: "LCP resource discovery",
    nextStep:
      "Check whether the LCP image is discoverable in the initial document and whether lazy loading or script insertion delays it.",
    automation:
      "No preload or theme markup changes are made by the audit.",
  },
  "font-display": {
    area: "Fonts",
    nextStep:
      "Check font format, weights, cross-origin behavior, and layout impact before changing font-display or adding preload hints.",
    automation:
      "Font optimization is not yet implemented.",
  },
  "uses-text-compression": {
    area: "Hosting and delivery",
    nextStep:
      "Check the response and Shopify/CDN delivery path; compression is controlled by the serving platform, not by changing the source file.",
    automation:
      "The app cannot change Shopify's server-side compression behavior.",
  },
  "uses-long-cache-ttl": {
    area: "Caching",
    nextStep:
      "Check which response is affected and whether its URL is versioned; do not assume the app controls Shopify CDN cache headers.",
    automation:
      "The app does not change Shopify CDN or browser cache policy.",
  },
};

export function guidanceForFinding(id: string): FindingGuidance {
  return (
    guidanceByAuditId[id] ?? {
      area: "Storefront diagnostic",
      nextStep:
        "Review the provider's finding and affected resource details. Validate any change on mobile and desktop before publishing.",
      automation:
        "No automatic storefront change is applied from an audit finding.",
    }
  );
}
