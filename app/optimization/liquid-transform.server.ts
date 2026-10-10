export type ThemeLiquidOptimizationMode =
  | "defer-js"
  | "lazy-images"
  | "prioritize-lcp";

export type LiquidImageTagCandidate = {
  index: number;
  line: number;
  expression: string;
  loading: string | null;
  loadingConfigured: boolean;
  fetchpriority: string | null;
  fetchpriorityConfigured: boolean;
};

export type ThemeLiquidTransformResult = {
  code: string;
  changedCount: number;
  skippedCount: number;
  candidateCount: number;
};

type SourceBlock = { start: number; end: number; content: string };
type SourceRange = { start: number; end: number };

function ignoredSourceRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  const patterns = [
    /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/gi,
    /\{%-?\s*raw\s*-?%\}[\s\S]*?\{%-?\s*endraw\s*-?%\}/gi,
    /<!--[\s\S]*?-->/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  return ranges;
}

function isIgnored(start: number, end: number, ranges: SourceRange[]) {
  return ranges.some((range) => range.start <= start && range.end >= end);
}

function liquidOutputBlocks(source: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf("{{", cursor);
    if (start === -1) break;
    const close = source.indexOf("}}", start + 2);
    if (close === -1) break;
    blocks.push({
      start,
      end: close + 2,
      content: source.slice(start + 2, close),
    });
    cursor = close + 2;
  }

  return blocks;
}

type LiquidFilterToken = { name: string; start: number; end: number };
type ArgumentRange = { start: number; end: number };
type NamedArgument = {
  range: ArgumentRange;
  prefix: string;
  rawValue: string;
};

function liquidFilterTokens(expression: string): LiquidFilterToken[] {
  const tokens: LiquidFilterToken[] = [];
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== "|") continue;

    let nameStart = index + 1;
    while (/\s/.test(expression[nameStart] ?? "")) nameStart += 1;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
      expression.slice(nameStart),
    );
    if (!nameMatch) continue;
    const end = nameStart + nameMatch[0].length;
    tokens.push({ name: nameMatch[0].toLowerCase(), start: index, end });
    index = end - 1;
  }
  return tokens;
}

function imageTagExpression(block: SourceBlock) {
  const leadingTrimmed = /^\s*-?\s*/.exec(block.content)?.[0] ?? "";
  const trailingTrimmed = /\s*-?\s*$/.exec(block.content)?.[0] ?? "";
  const expressionEnd = block.content.length - trailingTrimmed.length;
  const expression = block.content.slice(leadingTrimmed.length, expressionEnd);
  const filters = liquidFilterTokens(expression);
  const imageFilters = filters.filter((filter) => filter.name === "image_tag");
  if (imageFilters.length !== 1) return null;

  const filter = imageFilters[0];
  if (filters.some((item) => item.start > filter.start)) return null;
  const filterStart = filter.start;
  const filterEnd = filter.end;
  const argsSource = expression.slice(filterEnd);
  const colon = /^\s*:\s*/.exec(argsSource)?.[0] ?? "";
  const args = colon ? argsSource.slice(colon.length) : argsSource;
  return {
    expression,
    filterStart,
    filterEnd,
    args,
    hasColon: Boolean(colon),
    leadingTrimmed,
    trailingTrimmed,
  };
}

function argumentRanges(args: string): ArgumentRange[] {
  const ranges: ArgumentRange[] = [];
  let start = 0;
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < args.length; index += 1) {
    const character = args[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (character === "," && depth === 0) {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: args.length });
  return ranges;
}

function namedArguments(args: string, key: string): NamedArgument[] {
  const matches: NamedArgument[] = [];
  for (const range of argumentRanges(args)) {
    const part = args.slice(range.start, range.end);
    const prefix = /^(\s*[A-Za-z_][A-Za-z0-9_-]*\s*:\s*)/.exec(part);
    if (!prefix) continue;
    const parsedKey = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(part.trimStart())?.[0];
    if (parsedKey?.toLowerCase() !== key.toLowerCase()) continue;
    matches.push({
      range,
      prefix: prefix[0],
      rawValue: part.slice(prefix[0].length),
    });
  }
  return matches;
}

function stringLiteralValue(rawValue: string): { quote: string; value: string } | null {
  const leading = /^\s*/.exec(rawValue)?.[0] ?? "";
  const trailing = /\s*$/.exec(rawValue)?.[0] ?? "";
  const literal = rawValue.slice(leading.length, rawValue.length - trailing.length);
  const quote = literal[0];
  if ((quote !== "'" && quote !== '"') || literal.length < 2) return null;

  let escaped = false;
  for (let index = 1; index < literal.length; index += 1) {
    const character = literal[index];
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === quote) {
      if (index !== literal.length - 1) return null;
      return { quote, value: literal.slice(1, -1).toLowerCase() };
    }
  }
  return null;
}

function readStringArgument(args: string, key: string) {
  const matches = namedArguments(args, key);
  if (matches.length === 0) return { present: false, value: null as string | null };
  if (matches.length > 1) return { present: true, value: null as string | null };
  return {
    present: true,
    value: stringLiteralValue(matches[0].rawValue)?.value ?? null,
  };
}

function setStringArgument(
  args: string,
  key: string,
  value: string,
  replaceLiteral: boolean,
): { args: string; changed: boolean; safe: boolean } {
  const matches = namedArguments(args, key);
  if (matches.length > 1) return { args, changed: false, safe: false };

  if (matches.length === 1) {
    const match = matches[0];
    const parsed = stringLiteralValue(match.rawValue);
    if (!parsed) return { args, changed: false, safe: false };
    if (parsed.value === value) return { args, changed: false, safe: true };
    if (!replaceLiteral) return { args, changed: false, safe: false };

    const leadingValue = /^\s*/.exec(match.rawValue)?.[0] ?? "";
    const trailingValue = /\s*$/.exec(match.rawValue)?.[0] ?? "";
    const replacement = `${match.prefix}${leadingValue}${parsed.quote}${value}${parsed.quote}${trailingValue}`;
    return {
      args:
        args.slice(0, match.range.start) +
        replacement +
        args.slice(match.range.end),
      changed: true,
      safe: true,
    };
  }

  const withoutTrailingSpace = args.trimEnd();
  const trailingSpace = args.slice(withoutTrailingSpace.length);
  const separator = withoutTrailingSpace.length > 0 ? ", " : "";
  return {
    args: `${withoutTrailingSpace}${separator}${key}: '${value}'${trailingSpace}`,
    changed: true,
    safe: true,
  };
}

function transformImageExpression(
  block: SourceBlock,
  mode: Exclude<ThemeLiquidOptimizationMode, "defer-js">,
): { block: SourceBlock; changed: boolean } | null {
  const parsed = imageTagExpression(block);
  if (!parsed) return null;

  let args = parsed.args;
  let changed = false;
  if (mode === "lazy-images") {
    const currentLoading = readStringArgument(args, "loading");
    const currentPriority = readStringArgument(args, "fetchpriority");
    if (
      (currentLoading.present && currentLoading.value !== "lazy") ||
      (currentPriority.present && currentPriority.value === "high") ||
      (currentLoading.present && currentLoading.value === null) ||
      (currentPriority.present && currentPriority.value === null)
    ) {
      return { block, changed: false };
    }

    if (!currentLoading.present) {
      const result = setStringArgument(args, "loading", "lazy", false);
      if (!result.safe) return { block, changed: false };
      args = result.args;
      changed ||= result.changed;
    }
    if (!readStringArgument(args, "decoding").present) {
      const result = setStringArgument(args, "decoding", "async", false);
      if (!result.safe) return { block, changed: false };
      args = result.args;
      changed ||= result.changed;
    }
  } else {
    const loading = setStringArgument(args, "loading", "eager", true);
    if (!loading.safe) return { block, changed: false };
    args = loading.args;
    const priority = setStringArgument(args, "fetchpriority", "high", true);
    if (!priority.safe) return { block, changed: false };
    args = priority.args;
    changed = loading.changed || priority.changed;
  }

  if (!changed) return { block, changed: false };

  const argsSuffix = parsed.args.match(/\s*$/)?.[0] ?? "";
  const argsWithoutSuffix = args.slice(0, args.length - argsSuffix.length);
  const replacementArgs = parsed.hasColon || argsWithoutSuffix.length > 0
    ? `: ${argsWithoutSuffix}${argsSuffix}`
    : `: ${argsSuffix}`;
  const updatedExpression =
    parsed.expression.slice(0, parsed.filterEnd) + replacementArgs;
  const updatedContent =
    parsed.leadingTrimmed + updatedExpression + parsed.trailingTrimmed;

  return {
    block: { ...block, content: updatedContent },
    changed: true,
  };
}

function eligibleImageBlocks(source: string) {
  const ignoredRanges = ignoredSourceRanges(source);
  return liquidOutputBlocks(source).filter((block) => {
    if (isIgnored(block.start, block.end, ignoredRanges)) return false;
    return imageTagExpression(block) !== null;
  });
}

export function inspectShopifyImageTags(source: string): LiquidImageTagCandidate[] {
  return eligibleImageBlocks(source).map((block, index) => {
    const parsed = imageTagExpression(block);
    const expression = block.content.trim().replace(/^-|-$|\s+/g, " ");
    const line = source.slice(0, block.start).split("\n").length;
    const loadingArgument = parsed
      ? readStringArgument(parsed.args, "loading")
      : { present: false, value: null };
    const priorityArgument = parsed
      ? readStringArgument(parsed.args, "fetchpriority")
      : { present: false, value: null };
    return {
      index,
      line,
      expression: expression.slice(0, 240),
      loading: loadingArgument.value,
      loadingConfigured: loadingArgument.present,
      fetchpriority: priorityArgument.value,
      fetchpriorityConfigured: priorityArgument.present,
    };
  });
}

export function optimizeShopifyImageTags(
  source: string,
  mode: Exclude<ThemeLiquidOptimizationMode, "defer-js">,
  imageIndex?: number,
): ThemeLiquidTransformResult {
  const blocks = eligibleImageBlocks(source);
  const targets =
    mode === "prioritize-lcp"
      ? typeof imageIndex === "number" &&
        Number.isInteger(imageIndex) &&
        imageIndex >= 0 &&
        imageIndex < blocks.length
        ? [blocks[imageIndex]]
        : []
      : blocks;

  if (mode === "prioritize-lcp" && targets.length === 0) {
    throw new Error("Choose a valid Shopify image_tag expression first.");
  }

  const changes = new Map<number, string>();
  let changedCount = 0;
  for (const block of targets) {
    const result = transformImageExpression(block, mode);
    if (!result?.changed) continue;
    changes.set(block.start, result.block.content);
    changedCount += 1;
  }

  let code = source;
  for (const block of [...blocks].reverse()) {
    const replacement = changes.get(block.start);
    if (replacement === undefined) continue;
    code = `${code.slice(0, block.start + 2)}${replacement}${code.slice(block.end - 2)}`;
  }

  return {
    code,
    changedCount,
    candidateCount: targets.length,
    skippedCount: targets.length - changedCount,
  };
}

function isLiquidAssetScriptSource(value: string) {
  return /^\s*\{\{\s*(['"])([A-Za-z0-9_.-]+\.(?:js|mjs))\1\s*\|\s*asset_url\s*\}\}\s*$/i.test(
    value,
  );
}

function hasBooleanAttribute(tag: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|=|/?>)`, "i").test(tag);
}

function deferScriptTag(tag: string) {
  if (hasBooleanAttribute(tag, "defer") || hasBooleanAttribute(tag, "async")) {
    return null;
  }
  const typeAttribute = /(?:^|\s)type\s*=\s*(['"])(.*?)\1/i.exec(tag);
  if (
    typeAttribute &&
    !/^(?:text|application)\/(?:javascript|x-javascript)(?:\s*;.*)?$/i.test(
      typeAttribute[2].trim(),
    )
  ) {
    return null;
  }
  if (/(?:^|\s)data-(?:no-defer|speedboost-exclude)(?:\s|=|\/?>)/i.test(tag)) {
    return null;
  }

  const src = /(?:^|\s)src\s*=\s*(['"])([\s\S]*?)\1/i.exec(tag);
  if (!src || !isLiquidAssetScriptSource(src[2])) return null;
  return tag.replace(/>\s*$/, " defer>");
}

export function deferCompatibleThemeScripts(
  source: string,
): ThemeLiquidTransformResult {
  const ignoredRanges = ignoredSourceRanges(source);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const scriptTagLiquid = /\{\{\s*(['"])([A-Za-z0-9_.-]+\.(?:js|mjs))\1\s*\|\s*asset_url\s*\|\s*script_tag\s*\}\}/gi;

  for (const match of source.matchAll(scriptTagLiquid)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    if (isIgnored(match.index, end, ignoredRanges)) continue;
    const quote = match[1];
    const filename = match[2];
    replacements.push({
      start: match.index,
      end,
      value: `<script defer src="{{ ${quote}${filename}${quote} | asset_url }}"></script>`,
    });
  }

  let intermediate = source;
  for (const replacement of replacements.reverse()) {
    intermediate =
      intermediate.slice(0, replacement.start) +
      replacement.value +
      intermediate.slice(replacement.end);
  }

  const secondIgnoredRanges = ignoredSourceRanges(intermediate);
  const scriptElements = /<script\b[^>]*>\s*<\/script\s*>/gi;
  const tagReplacements: Array<{ start: number; end: number; value: string }> = [];
  for (const match of intermediate.matchAll(scriptElements)) {
    if (match.index === undefined) continue;
    const end = match.index + match[0].length;
    if (isIgnored(match.index, end, secondIgnoredRanges)) continue;
    const openEnd = match[0].indexOf(">");
    const startTag = match[0].slice(0, openEnd + 1);
    const deferred = deferScriptTag(startTag);
    if (!deferred) continue;
    tagReplacements.push({
      start: match.index,
      end,
      value: `${deferred}${match[0].slice(openEnd + 1)}`,
    });
  }

  let code = intermediate;
  for (const replacement of tagReplacements.reverse()) {
    code =
      code.slice(0, replacement.start) +
      replacement.value +
      code.slice(replacement.end);
  }

  const changedCount = replacements.length + tagReplacements.length;
  return {
    code,
    changedCount,
    candidateCount: changedCount,
    skippedCount: 0,
  };
}

export function transformThemeLiquid(
  source: string,
  mode: ThemeLiquidOptimizationMode,
  imageIndex?: number,
): ThemeLiquidTransformResult {
  if (mode === "defer-js") return deferCompatibleThemeScripts(source);
  return optimizeShopifyImageTags(source, mode, imageIndex);
}

export function modeForThemeLiquidHash(
  source: string,
  expectedHash: (value: string) => string,
  desiredHash: string,
): string | null {
  const scriptResult = deferCompatibleThemeScripts(source);
  if (scriptResult.changedCount > 0 && expectedHash(scriptResult.code) === desiredHash) {
    return "defer-js";
  }

  const lazyResult = optimizeShopifyImageTags(source, "lazy-images");
  if (lazyResult.changedCount > 0 && expectedHash(lazyResult.code) === desiredHash) {
    return "lazy-images";
  }

  const candidates = inspectShopifyImageTags(source);
  for (const candidate of candidates) {
    const lcpResult = optimizeShopifyImageTags(
      source,
      "prioritize-lcp",
      candidate.index,
    );
    if (lcpResult.changedCount > 0 && expectedHash(lcpResult.code) === desiredHash) {
      return "prioritize-lcp";
    }
  }

  return null;
}
