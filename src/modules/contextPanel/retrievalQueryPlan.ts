import {
  callLLM,
  type ChatParams,
  type ReasoningConfig,
} from "../../utils/llmClient";
import type { ProviderProtocol } from "../../utils/providerProtocol";
import { tokenizeRetrievalQuery } from "./retrievalTokenizer";

export type RetrievalQueryPlan = {
  originalQuery: string;
  variants: string[];
  effectiveQueries: string[];
  lexicalTerms: string[];
  semanticQuery: string;
  variantLimitHit: boolean;
  notes: string[];
};

export const RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT = 6;
export const RETRIEVAL_QUERY_VARIANT_HARD_LIMIT = 8;
const RETRIEVAL_QUERY_VARIANT_MAX_CHARS = 160;
const RETRIEVAL_SEMANTIC_QUERY_MAX_CHARS = 700;
const RETRIEVAL_QUERY_PLAN_TIMEOUT_MS = 2500;

function normalizeQueryText(value: unknown, maxChars = 0): string {
  const normalized = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  if (!maxChars || normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).trim();
}

function normalizeComparableQuery(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function clampVariantLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT;
  }
  return Math.max(
    1,
    Math.min(RETRIEVAL_QUERY_VARIANT_HARD_LIMIT, Math.floor(parsed)),
  );
}

function normalizeVariants(params: {
  originalQuery: string;
  variants?: unknown[];
  maxVariants?: number;
}): { variants: string[]; variantLimitHit: boolean } {
  const maxVariants = clampVariantLimit(params.maxVariants);
  const originalComparable = normalizeComparableQuery(params.originalQuery);
  const seen = new Set<string>(originalComparable ? [originalComparable] : []);
  const out: string[] = [];
  let nonEmptyCount = 0;
  for (const value of params.variants || []) {
    const normalized = normalizeQueryText(
      value,
      RETRIEVAL_QUERY_VARIANT_MAX_CHARS,
    );
    if (!normalized) continue;
    nonEmptyCount += 1;
    const comparable = normalizeComparableQuery(normalized);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    if (out.length >= maxVariants) continue;
    out.push(normalized);
  }
  return {
    variants: out,
    variantLimitHit: nonEmptyCount > out.length,
  };
}

function buildSemanticQuery(effectiveQueries: string[]): string {
  const joined = effectiveQueries
    .map((query, index) => (index === 0 ? query : `Variant: ${query}`))
    .filter(Boolean)
    .join("\n");
  return normalizeQueryText(joined, RETRIEVAL_SEMANTIC_QUERY_MAX_CHARS);
}

export function buildRetrievalQueryPlan(params: {
  query: string;
  queryVariants?: unknown[];
  maxVariants?: number;
  notes?: string[];
}): RetrievalQueryPlan {
  const originalQuery = normalizeQueryText(params.query);
  const normalized = normalizeVariants({
    originalQuery,
    variants: params.queryVariants,
    maxVariants: params.maxVariants,
  });
  const effectiveQueries = [originalQuery, ...normalized.variants].filter(
    Boolean,
  );
  const lexicalTerms = Array.from(
    new Set(effectiveQueries.flatMap((query) => tokenizeRetrievalQuery(query))),
  );
  const notes = [...(params.notes || [])];
  if (normalized.variantLimitHit) {
    notes.push(
      `Query variants were capped at ${clampVariantLimit(params.maxVariants)}.`,
    );
  }
  if (!normalized.variants.length) {
    notes.push("No query variants were used.");
  }
  return {
    originalQuery,
    variants: normalized.variants,
    effectiveQueries,
    lexicalTerms,
    semanticQuery: buildSemanticQuery(effectiveQueries),
    variantLimitHit: normalized.variantLimitHit,
    notes,
  };
}

export function buildRetrievalQueryPlanCacheKey(
  queryPlan: RetrievalQueryPlan,
): string {
  return [queryPlan.originalQuery, ...queryPlan.variants]
    .map((entry) =>
      normalizeComparableQuery(entry)
        .replace(/[^\p{L}\p{N}\s_-]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" || ")
    .slice(0, 300);
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || "",
    trimmed.match(/\{[\s\S]*\}/)?.[0] || "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next extraction shape.
    }
  }
  return null;
}

function isLikelyExactLookupQuery(query: string): boolean {
  const lower = query.toLocaleLowerCase();
  if (/\b10\.\d{4,9}\/[-._;()/:a-z0-9]+\b/i.test(query)) return true;
  if (/\b(?:doi|pmid|pmcid|isbn|issn|arxiv|citation key)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(?:exact phrase|literal phrase|verbatim|exact quote|quote exactly)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(?:title|author)\b/.test(lower) &&
    /\b(?:find|lookup|look up|search|open|locate)\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

export function shouldAutoGenerateQueryVariants(params: {
  query: string;
  hasRetrievalContext: boolean;
}): boolean {
  const query = normalizeQueryText(params.query);
  if (!params.hasRetrievalContext || query.length < 4) return false;
  return !isLikelyExactLookupQuery(query);
}

async function callWithTimeout(
  params: Omit<ChatParams, "signal"> & {
    parentSignal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs || RETRIEVAL_QUERY_PLAN_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  params.parentSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await callLLM({
      ...params,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    params.parentSignal?.removeEventListener("abort", onAbort);
  }
}

export async function generateRetrievalQueryPlanWithModel(params: {
  query: string;
  hasRetrievalContext: boolean;
  model?: string;
  apiBase?: string;
  apiKey?: string;
  authMode?: ChatParams["authMode"];
  providerProtocol?: ProviderProtocol;
  reasoning?: ReasoningConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RetrievalQueryPlan> {
  const fallback = buildRetrievalQueryPlan({ query: params.query });
  if (!shouldAutoGenerateQueryVariants(params)) return fallback;
  if (!params.apiBase && !params.apiKey) return fallback;

  const prompt = [
    "Generate search query variants for retrieval from a user's Zotero papers.",
    'Return strict JSON only in this shape: {"variants":["..."]}.',
    "Generate search probes, not an answer.",
    "Preserve the user's intent.",
    "If the user query is not in English and the corpus is likely English, translate key concepts into English.",
    "Include common acronyms, notation variants, and technical equivalents when useful.",
    "Avoid broad conceptual drift and do not invent paper-specific claims.",
    `Return at most ${RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT} variants.`,
    "",
    `User query: ${params.query}`,
  ].join("\n");

  try {
    const raw = await callWithTimeout({
      prompt,
      model: params.model,
      apiBase: params.apiBase,
      apiKey: params.apiKey,
      authMode: params.authMode,
      providerProtocol: params.providerProtocol,
      reasoning: params.reasoning,
      maxTokens: 260,
      temperature: 0,
      parentSignal: params.signal,
      timeoutMs: params.timeoutMs,
      systemMessages: [
        "You are a retrieval query planner. Return JSON only. Do not answer the user's research question.",
      ],
    });
    const parsed = extractJsonObject(raw);
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    return buildRetrievalQueryPlan({
      query: params.query,
      queryVariants: variants,
      notes: variants.length
        ? ["Query variants were generated by the retrieval planner."]
        : ["The retrieval planner returned no usable variants."],
    });
  } catch {
    return buildRetrievalQueryPlan({
      query: params.query,
      notes: ["Query variant planning failed; used the original query only."],
    });
  }
}

function hasUsableVariants(values: unknown[] | undefined): boolean {
  return (
    Array.isArray(values) && values.some((value) => normalizeQueryText(value))
  );
}

export async function resolveRetrievalQueryPlan(params: {
  query: string;
  queryVariants?: unknown[];
  queryPlan?: RetrievalQueryPlan;
  hasRetrievalContext: boolean;
  model?: string;
  apiBase?: string;
  apiKey?: string;
  authMode?: ChatParams["authMode"];
  providerProtocol?: ProviderProtocol;
  reasoning?: ReasoningConfig;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<RetrievalQueryPlan> {
  if (params.queryPlan) return params.queryPlan;
  if (hasUsableVariants(params.queryVariants)) {
    return buildRetrievalQueryPlan({
      query: params.query,
      queryVariants: params.queryVariants,
      notes: ["Query variants were provided by the caller."],
    });
  }
  return generateRetrievalQueryPlanWithModel({
    query: params.query,
    hasRetrievalContext: params.hasRetrievalContext,
    model: params.model,
    apiBase: params.apiBase,
    apiKey: params.apiKey,
    authMode: params.authMode,
    providerProtocol: params.providerProtocol,
    reasoning: params.reasoning,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
  });
}
