import type { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { embedStateFromSettingsData, type EmbedState, type EmbedStatus } from "./embed-status";

export type { EmbedStatus };

type AdminApi = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

const LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAIN_THEME_SETTINGS = `#graphql
  query SpeedBoostEmbedStatus {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
      }
    }
  }
`;

type ThemeQuery = {
  data?: {
    themes?: {
      nodes: Array<{
        name: string;
        files?: { nodes: Array<{ body?: { content?: string } }> };
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

async function readMainThemeState(admin: AdminApi) {
  const response = await admin.graphql(MAIN_THEME_SETTINGS);
  const payload = (await response.json()) as ThemeQuery;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || "Theme query failed");
  }
  const theme = payload.data?.themes?.nodes[0];
  if (!theme) throw new Error("Shopify returned no published theme");
  const content = theme.files?.nodes[0]?.body?.content;
  if (typeof content !== "string") {
    // A theme without saved settings has no embeds turned on.
    return { state: "not-added" as const, name: theme.name };
  }
  return { state: embedStateFromSettingsData(content), name: theme.name };
}

/**
 * Embed status from two independent signals. The saved theme setting is
 * authoritative; the storefront heartbeat confirms the runtime executed. A
 * failed theme read reports "unknown" — never a false "not enabled".
 */
export async function getEmbedStatus(admin: AdminApi, shop: string): Promise<EmbedStatus> {
  const [themeResult, heartbeat] = await Promise.all([
    readMainThemeState(admin).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
    prisma.themeEmbedHeartbeat.findUnique({ where: { shop } }).catch(() => null),
  ]);
  const live = Boolean(
    heartbeat && heartbeat.lastSeenAt.getTime() > Date.now() - LIVE_WINDOW_MS,
  );
  if (!themeResult.ok) {
    console.warn("App embed theme check failed", {
      shop,
      error: themeResult.error instanceof Error ? themeResult.error.message : "unknown",
    });
  }
  return {
    theme: themeResult.ok ? themeResult.value.state : "unknown",
    themeName: themeResult.ok ? themeResult.value.name : null,
    live,
    lastSeenAt: heartbeat?.lastSeenAt.toISOString() ?? null,
    error: themeResult.ok ? null : "The live theme's settings could not be read right now.",
  };
}

export type ThemeEmbedRow = {
  id: string;
  name: string;
  role: string;
  state: EmbedState | "unknown";
};

/** Embed state for every theme in the store (for the setup guide). */
export async function getEmbedStateByTheme(admin: AdminApi): Promise<ThemeEmbedRow[]> {
  const response = await admin.graphql(`#graphql
    query SpeedBoostEmbedByTheme {
      themes(first: 20) {
        nodes {
          id
          name
          role
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
          }
        }
      }
    }`);
  const payload = (await response.json()) as {
    data?: {
      themes?: {
        nodes: Array<{ id: string; name: string; role: string; files?: { nodes: Array<{ body?: { content?: string } }> } }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length || !payload.data?.themes) {
    throw new Error(payload.errors?.[0]?.message || "Themes could not be read");
  }
  return payload.data.themes.nodes
    .filter((theme) => theme.role === "MAIN" || theme.role === "UNPUBLISHED" || theme.role === "DEVELOPMENT")
    .map((theme) => {
      const content = theme.files?.nodes[0]?.body?.content;
      let state: EmbedState | "unknown" = "not-added";
      if (typeof content === "string") {
        try {
          state = embedStateFromSettingsData(content);
        } catch {
          state = "unknown";
        }
      }
      return { id: theme.id, name: theme.name, role: theme.role, state };
    })
    .sort((a, b) => Number(b.role === "MAIN") - Number(a.role === "MAIN"));
}
