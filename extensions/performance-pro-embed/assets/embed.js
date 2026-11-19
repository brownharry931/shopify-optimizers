(() => {
  // Theme-editor previews do not prove that the embed is live on the storefront.
  if (window.Shopify && window.Shopify.designMode) return;

  let config = {};
  try {
    const node = document.getElementById("sb-config");
    if (node) config = JSON.parse(node.textContent || "{}");
  } catch {
    config = {};
  }

  /* Lazy video / embed iframes: restore the real src near the viewport. */
  if (config.lazyMedia) {
    const frames = document.querySelectorAll("iframe[data-sb-src]");
    const load = (frame) => {
      const src = frame.getAttribute("data-sb-src");
      if (src && frame.src !== src) frame.src = src;
    };
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            load(entry.target);
          }
        },
        { rootMargin: "400px 0px" },
      );
      frames.forEach((frame) => observer.observe(frame));
    } else {
      frames.forEach(load);
    }
  }

  /* Instant page fallback for browsers without Speculation Rules. */
  const supportsSpeculation =
    typeof HTMLScriptElement !== "undefined" &&
    typeof HTMLScriptElement.supports === "function" &&
    HTMLScriptElement.supports("speculationrules");
  if (config.instantPage && !supportsSpeculation) {
    const seen = new Set();
    const skip = /^\/(cart|checkout|checkouts|account|apps)(\/|$)|logout/;
    const prefetch = (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.hasAttribute("data-no-prefetch")) return;
      let url;
      try {
        url = new URL(link.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || skip.test(url.pathname)) return;
      if (url.pathname === location.pathname || seen.has(url.href)) return;
      seen.add(url.href);
      const hint = document.createElement("link");
      hint.rel = "prefetch";
      hint.href = url.href;
      document.head.appendChild(hint);
    };
    document.addEventListener("mouseover", prefetch, { passive: true });
    document.addEventListener("touchstart", prefetch, { passive: true });
  }

  /* Top loading bar on same-origin navigations. */
  if (config.loadingBar) {
    const bar = document.createElement("div");
    bar.id = "sb-loading-bar";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    const start = () => {
      bar.style.opacity = "1";
      bar.style.width = "35%";
      setTimeout(() => (bar.style.width = "75%"), 250);
      setTimeout(() => (bar.style.width = "90%"), 1200);
    };
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      let url;
      try {
        url = new URL(link.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return;
      start();
    });
    window.addEventListener("pageshow", () => {
      bar.style.opacity = "0";
      bar.style.width = "0";
    });
  }

  // Same-origin Shopify App Proxy request; the server verifies Shopify's proxy
  // signature and derives the shop from that verified session, not from input.
  // Throttled to once per browser per day: it only confirms the runtime is
  // live, so it must not add a server request to every storefront page view.
  try {
    const last = Number(localStorage.getItem("sb-heartbeat") || 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    localStorage.setItem("sb-heartbeat", String(Date.now()));
  } catch {
    // Storage blocked (private mode): fall through and ping once.
  }
  fetch("/apps/speedboost/heartbeat", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {
    // Storefront rendering must never depend on the optional verification ping.
  });
})();
