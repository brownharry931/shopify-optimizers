/**
 * Read-only theme audit. Takes theme file contents and returns findings
 * written for merchants: what was found, why it matters, and exactly how to
 * fix it by hand. Nothing here (or anywhere in the app) writes theme files —
 * Shopify App Store requirement 5.1.1.
 *
 * Pure module: no network, safe to unit-test.
 */

export type Severity = "high" | "medium" | "low";
export type Category = "javascript" | "css" | "images" | "fonts" | "cleanup";

export type ThemeFileInput = {
  filename: string;
  size: number;
  content?: string;
};

export type MinifyMeasurement = {
  filename: string;
  sourceBytes: number;
  minifiedBytes: number;
};

export type Finding = {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  file: string;
  line: number | null;
  /** Code as it is today (trimmed), when relevant. */
  current: string | null;
  /** Ready-to-paste replacement, when one exists. */
  fix: string | null;
  why: string;
  steps: string[];
  bytes?: { before: number; after: number };
};

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const CATEGORY_LABEL: Record<Category, string> = {
  javascript: "JavaScript",
  css: "CSS",
  images: "Images & video",
  fonts: "Fonts",
  cleanup: "Clean-up",
};

const EDIT_CODE_STEP =
  "In Shopify admin go to Online Store → Themes, click ⋯ next to this theme and choose Edit code (or use “Open in code editor” here).";
const DUPLICATE_STEP =
  "Before editing, make a backup: Online Store → Themes → ⋯ → Duplicate.";
const CHECK_STEP =
  "Save, open your store and check menus, product options, add to cart and the cart drawer still work. Then run a new Speed audit to measure the change.";

function lineOf(content: string, index: number) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function clip(value: string, max = 220) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Ranges covered by Liquid comments / raw blocks, which must be ignored. */
function ignoredRanges(content: string) {
  const ranges: Array<[number, number]> = [];
  for (const pattern of [
    /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/gi,
    /\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/gi,
    /\{%-?\s*#[\s\S]*?-?%\}/g,
    /\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/gi,
    /<!--[\s\S]*?-->/g,
  ]) {
    for (const match of content.matchAll(pattern)) {
      ranges.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
  }
  return (index: number) => ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * Find opening HTML tags by name, skipping over Liquid ({{ }} / {% %}) and
 * quoted attribute values, so `{% if image.width > 165 %}` inside a tag does
 * not end it early.
 */
export function findTags(content: string, name: string) {
  const tags: Array<{ index: number; tag: string }> = [];
  const opener = new RegExp(`<${name}\\b`, "gi");
  for (const match of content.matchAll(opener)) {
    const start = match.index ?? 0;
    let i = start + match[0].length;
    let quote: string | null = null;
    while (i < content.length) {
      const char = content[i];
      if (!quote && (content.startsWith("{{", i) || content.startsWith("{%", i))) {
        const close = content.indexOf(content[i + 1] === "{" ? "}}" : "%}", i + 2);
        if (close === -1) break;
        i = close + 2;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        tags.push({ index: start, tag: content.slice(start, i + 1) });
        break;
      }
      i += 1;
    }
  }
  return tags;
}

/** Tag text with Liquid blocks removed, for attribute checks. */
function plainAttributes(tag: string) {
  return tag.replace(/\{%[\s\S]*?%\}/g, " ");
}

function attr(tag: string, name: string) {
  return new RegExp(`\\s${name}(\\s*=|\\s|>|/)`, "i").test(tag);
}

/* ------------------------------------------------------------------ */
/* JavaScript                                                          */
/* ------------------------------------------------------------------ */

function renderBlockingScripts(file: ThemeFileInput): Finding[] {
  const content = file.content ?? "";
  const headEnd = content.search(/<\/head>/i);
  if (headEnd === -1) return [];
  const ignored = ignoredRanges(content);
  const findings: Finding[] = [];

  for (const { tag, index } of findTags(content.slice(0, headEnd), "script")) {
    if (ignored(index)) continue;
    const plain = plainAttributes(tag);
    if (!/\ssrc\s*=/i.test(plain)) continue; // inline scripts can't be deferred
    if (attr(tag, "defer") || attr(tag, "async")) continue;
    if (/type\s*=\s*["']?module/i.test(tag)) continue; // modules are deferred by default
    if (/type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(tag)) continue;
    findings.push({
      id: `blocking-script:${file.filename}:${index}`,
      severity: "high",
      category: "javascript",
      title: "A script stops the page from showing until it downloads",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(tag),
      fix: tag.replace(/<script\b/i, "<script defer"),
      why: "Scripts in the page <head> without “defer” make the browser stop drawing your store until the file has downloaded and run. Adding “defer” lets the page appear first and runs the script right after — usually the single biggest gain for First Contentful Paint.",
      steps: [
        DUPLICATE_STEP,
        EDIT_CODE_STEP,
        `Open ${file.filename} and go to line ${lineOf(content, index)}.`,
        "Replace the line shown under “Current code” with the “Fixed code”.",
        CHECK_STEP,
      ],
    });
  }

  for (const match of content.slice(0, headEnd).matchAll(/\{\{-?\s*(['"][^'"]+\.js['"])\s*\|\s*asset_url\s*\|\s*script_tag\s*-?\}\}/gi)) {
    const index = match.index ?? 0;
    if (ignored(index)) continue;
    findings.push({
      id: `blocking-script-tag:${file.filename}:${index}`,
      severity: "high",
      category: "javascript",
      title: "A theme script is loaded in a way that blocks the page",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(match[0]),
      fix: `<script src="{{ ${match[1]} | asset_url }}" defer="defer"></script>`,
      why: "Shopify's script_tag filter outputs a script without “defer”, so the browser waits for it before showing the page.",
      steps: [
        DUPLICATE_STEP,
        EDIT_CODE_STEP,
        `Open ${file.filename}, line ${lineOf(content, index)}.`,
        "Replace the current code with the fixed code.",
        CHECK_STEP,
      ],
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Images & iframes                                                    */
/* ------------------------------------------------------------------ */

/** Markup inside <template> is inert until script clones it (e.g. click-to-play video). */
function templateRanges(content: string) {
  const ranges: Array<[number, number]> = [];
  for (const match of content.matchAll(/<template\b[\s\S]*?<\/template>/gi)) {
    ranges.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  return (index: number) => ranges.some(([start, end]) => index >= start && index < end);
}

// Sections that normally sit at the top of a page: never suggest lazy loading there.
const ABOVE_THE_FOLD = /(hero|banner|slideshow|main-product|featured-product|header|announcement)/i;

function mediaFindings(file: ThemeFileInput): Finding[] {
  const content = file.content ?? "";
  const ignoredComment = ignoredRanges(content);
  const inTemplate = templateRanges(content);
  const ignored = (index: number) => ignoredComment(index) || inTemplate(index);
  const likelyAboveFold = ABOVE_THE_FOLD.test(file.filename);
  const findings: Finding[] = [];

  for (const { tag, index } of findTags(content, "img")) {
    if (ignored(index)) continue;
    // Attributes set inside Liquid conditionals still count as present.
    const attrs = tag;
    const missingLazy = !likelyAboveFold && !attr(attrs, "loading") && !attr(attrs, "fetchpriority");
    const missingSize = !attr(attrs, "width") || !attr(attrs, "height");
    if (!missingLazy && !missingSize) continue;
    let fixed = tag;
    if (missingLazy) fixed = fixed.replace(/<img\b/i, '<img loading="lazy" decoding="async"');
    findings.push({
      id: `img:${file.filename}:${index}`,
      severity: "medium",
      category: "images",
      title: missingLazy && missingSize
        ? "An image loads immediately and has no size set"
        : missingLazy
          ? "An image loads immediately, even when it is far down the page"
          : "An image has no width and height, so the page can jump",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(tag),
      fix: missingLazy ? fixed : null,
      why: [
        missingLazy
          ? "Without loading=\"lazy\" the browser downloads this image straight away, competing with the images visitors actually see first."
          : "",
        missingSize
          ? "Without width and height the browser can't reserve space, so content moves when the image arrives (Cumulative Layout Shift)."
          : "",
      ].filter(Boolean).join(" "),
      steps: [
        DUPLICATE_STEP,
        EDIT_CODE_STEP,
        `Open ${file.filename}, line ${lineOf(content, index)}.`,
        missingLazy
          ? "Only if this image is NOT at the top of the page (not the hero or main product photo): replace it with the fixed code. Leave the first, most visible image as it is."
          : "Add width=\"…\" and height=\"…\" with the image's real pixel size (or use Shopify's image_tag filter, which adds them).",
        missingSize && missingLazy
          ? "Also add width and height attributes with the image's real pixel size."
          : CHECK_STEP,
        ...(missingSize && missingLazy ? [CHECK_STEP] : []),
      ],
    });
  }

  for (const { tag, index } of findTags(content, "iframe")) {
    if (ignored(index) || attr(tag, "loading")) continue;
    findings.push({
      id: `iframe:${file.filename}:${index}`,
      severity: "medium",
      category: "images",
      title: "An embedded video or map loads before it is needed",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(tag),
      fix: tag.replace(/<iframe\b/i, '<iframe loading="lazy"'),
      why: "Embeds such as YouTube or Google Maps download a lot of code. With loading=\"lazy\" they wait until the visitor scrolls near them. (Speed boosters → Lazy-load videos & embeds also handles this without code changes.)",
      steps: [DUPLICATE_STEP, EDIT_CODE_STEP, `Open ${file.filename}, line ${lineOf(content, index)}.`, "Replace the current code with the fixed code.", CHECK_STEP],
    });
  }
  return findings;
}

function largeAssetImages(files: ThemeFileInput[]): Finding[] {
  return files
    .filter((file) => /^assets\/.+\.(png|jpe?g|gif)$/i.test(file.filename) && file.size > 200 * 1024)
    .map((file) => ({
      id: `large-image:${file.filename}`,
      severity: file.size > 500 * 1024 ? ("high" as const) : ("medium" as const),
      category: "images" as const,
      title: "A large image is stored in the theme's files",
      file: file.filename,
      line: null,
      current: null,
      fix: null,
      why: `This file is ${(file.size / 1024).toFixed(0)} KB. Images in theme assets are served as-is; images uploaded to Shopify (Content → Files or in section settings) are automatically resized and converted to modern formats like WebP and AVIF.`,
      steps: [
        "Upload the image in Content → Files (or pick it in the section's image setting in the theme editor) instead of using the theme asset.",
        "Where the theme code uses it, prefer an image setting rendered with image_url and image_tag, which serve the right size for each screen.",
        CHECK_STEP,
      ],
    }));
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

function fontFindings(file: ThemeFileInput): Finding[] {
  const content = file.content ?? "";
  const ignored = ignoredRanges(content);
  const findings: Finding[] = [];

  for (const match of content.matchAll(/\{\{-?\s*([\w.[\]'"]+)\s*\|\s*font_face(\s*-?\}\}|\s*:[^}]*\}\})/gi)) {
    const index = match.index ?? 0;
    if (ignored(index) || /font_display/i.test(match[0])) continue;
    findings.push({
      id: `font-face:${file.filename}:${index}`,
      severity: "medium",
      category: "fonts",
      title: "Text stays invisible while a font downloads",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(match[0]),
      fix: `{{ ${match[1]} | font_face: font_display: 'swap' }}`,
      why: "Without font-display: swap, browsers hide text until the custom font arrives. With swap, text shows at once in a fallback font and switches when the font is ready.",
      steps: [DUPLICATE_STEP, EDIT_CODE_STEP, `Open ${file.filename}, line ${lineOf(content, index)}.`, "Replace the current code with the fixed code.", CHECK_STEP],
    });
  }

  for (const match of content.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
    const index = match.index ?? 0;
    if (ignored(index) || /font-display/i.test(match[0])) continue;
    findings.push({
      id: `css-font-face:${file.filename}:${index}`,
      severity: "medium",
      category: "fonts",
      title: "A custom font hides text until it has downloaded",
      file: file.filename,
      line: lineOf(content, index),
      current: clip(match[0]),
      fix: match[0].replace(/\{/, "{\n  font-display: swap;"),
      why: "This @font-face rule has no font-display, so text may stay invisible while the font loads.",
      steps: [DUPLICATE_STEP, EDIT_CODE_STEP, `Open ${file.filename}, line ${lineOf(content, index)}.`, "Add the line font-display: swap; inside the @font-face block, as in the fixed code.", CHECK_STEP],
    });
  }
  return findings;
}

function preconnectFinding(layout: ThemeFileInput): Finding[] {
  const content = layout.content ?? "";
  const usesShopifyFonts = /font_url|font_face|fonts\.shopifycdn\.com/i.test(content);
  if (!usesShopifyFonts || /preconnect[^>]*fonts\.shopifycdn\.com/i.test(content)) return [];
  const headStart = content.search(/<head[^>]*>/i);
  return [
    {
      id: `preconnect:${layout.filename}`,
      severity: "low",
      category: "fonts",
      title: "The browser connects to Shopify's font server late",
      file: layout.filename,
      line: headStart === -1 ? null : lineOf(content, headStart),
      current: null,
      fix: '<link rel="preconnect" href="https://fonts.shopifycdn.com" crossorigin>',
      why: "Your theme uses Shopify fonts. A preconnect hint opens the connection to the font server early, so fonts arrive sooner. (Speed boosters → Optimize fonts adds this automatically without code changes.)",
      steps: [EDIT_CODE_STEP, `Open ${layout.filename} and paste the fixed code on the line right after <head>.`, CHECK_STEP],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Minification and clean-up                                           */
/* ------------------------------------------------------------------ */

function minifyFindings(measurements: MinifyMeasurement[]): Finding[] {
  return measurements
    .filter((item) => {
      const saved = item.sourceBytes - item.minifiedBytes;
      return saved >= 2048 && saved / item.sourceBytes >= 0.15;
    })
    .map((item) => {
      const saved = item.sourceBytes - item.minifiedBytes;
      const isCss = /\.css$/i.test(item.filename);
      return {
        id: `minify:${item.filename}`,
        severity: saved >= 20 * 1024 ? ("high" as const) : ("medium" as const),
        category: isCss ? ("css" as const) : ("javascript" as const),
        title: `${isCss ? "A stylesheet" : "A script"} can be ${Math.round((saved / item.sourceBytes) * 100)}% smaller`,
        file: item.filename,
        line: null,
        current: null,
        fix: null,
        bytes: { before: item.sourceBytes, after: item.minifiedBytes },
        why: `This file contains spaces, comments and long names browsers don't need. A minified copy does exactly the same thing in ${(item.minifiedBytes / 1024).toFixed(1)} KB instead of ${(item.sourceBytes / 1024).toFixed(1)} KB. Shopify compresses files during transfer, so the real download saving is smaller than this, but the browser also has less code to read.`,
        steps: [
          DUPLICATE_STEP,
          "Click “Show minified file” below and then “Copy”.",
          EDIT_CODE_STEP,
          `Open ${item.filename}, select all the code (Ctrl/Cmd + A) and paste the minified version over it.`,
          CHECK_STEP,
          "If anything breaks, restore the duplicate theme or use the file's “Older versions” menu in the code editor.",
        ],
      };
    });
}

function unusedSnippets(files: ThemeFileInput[]): Finding[] {
  const snippets = files.filter((file) => /^snippets\/[^/]+\.liquid$/.test(file.filename));
  const corpus = files
    .filter((file) => /\.(liquid|json)$/i.test(file.filename) && file.content)
    .map((file) => file.content)
    .join("\n");
  // Dynamic render calls (render variable) mean we can't be sure — stop.
  if (/\{%-?\s*(render|include)\s+[a-z_][\w.]*\s/i.test(corpus)) return [];
  return snippets
    .filter((file) => {
      const name = file.filename.slice("snippets/".length, -".liquid".length);
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`(render|include)\\s+['"]${escaped}['"]|["']${escaped}["']`).test(corpus);
    })
    .map((file) => ({
      id: `unused:${file.filename}`,
      severity: "low" as const,
      category: "cleanup" as const,
      title: "A snippet that nothing uses (often left behind by a removed app)",
      file: file.filename,
      line: null,
      current: null,
      fix: null,
      why: "No other theme file renders this snippet. Unused files don't slow the page by themselves, but leftover app snippets are often still referenced by old script or style tags. Removing them keeps the theme tidy.",
      steps: [
        DUPLICATE_STEP,
        "Search the theme code for the snippet name to be sure it isn't used, and check the app it came from is uninstalled.",
        EDIT_CODE_STEP,
        `Delete ${file.filename} only if you're sure. If unsure, leave it — it does no harm.`,
      ],
    }));
}

/* ------------------------------------------------------------------ */

export function auditTheme(files: ThemeFileInput[], measurements: MinifyMeasurement[] = []) {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.content) continue;
    if (/^layout\/.+\.liquid$/.test(file.filename)) {
      findings.push(...renderBlockingScripts(file), ...preconnectFinding(file));
    }
    if (/^(sections|snippets|blocks|layout|templates)\/.+\.liquid$/.test(file.filename)) {
      findings.push(...mediaFindings(file), ...fontFindings(file));
    }
    if (/^assets\/.+\.css(\.liquid)?$/i.test(file.filename)) {
      findings.push(...fontFindings(file));
    }
  }
  findings.push(...largeAssetImages(files), ...minifyFindings(measurements), ...unusedSnippets(files));
  findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0),
  );
  return findings;
}

/** Files worth minifying: plain theme CSS/JS, not Liquid templates or already-minified files. */
export function minifyCandidates(files: ThemeFileInput[], limit = 20) {
  return files
    .filter((file) => /^assets\/[^/]+\.(css|js)$/i.test(file.filename))
    .filter((file) => !/\.min\.(css|js)$/i.test(file.filename))
    .filter((file) => file.size >= 4 * 1024 && file.size <= 1.5 * 1024 * 1024)
    .sort((a, b) => b.size - a.size)
    .slice(0, limit);
}
