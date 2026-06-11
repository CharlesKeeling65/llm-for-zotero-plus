import type { PaperContextRef } from "../../../shared/types";
import type { AgentToolDefinition } from "../../types";
import { LiteratureSearchService } from "../../services/literatureSearchService";
import type { ZoteroGateway } from "../../services/zoteroGateway";
import {
  createSearchLiteratureReviewAction,
  resolveSearchLiteratureReview,
} from "../../reviewCards";
import {
  fail,
  normalizePositiveInt,
  normalizeToolPaperContext,
  ok,
  PAPER_CONTEXT_REF_SCHEMA,
  validateObject,
} from "../shared";

type SearchLiteratureOnlineMode =
  | "recommendations"
  | "references"
  | "citations"
  | "search"
  | "metadata";

type SearchLiteratureOnlineWorkflow = "answer" | "review";

type SearchLiteratureOnlineInput = {
  workflow: SearchLiteratureOnlineWorkflow;
  mode: SearchLiteratureOnlineMode;
  source?: "openalex" | "arxiv" | "europepmc";
  itemId?: number;
  paperContext?: PaperContextRef;
  doi?: string;
  title?: string;
  arxivId?: string;
  query?: string;
  author?: string;
  limit?: number;
  libraryID?: number;
};

export function createSearchLiteratureOnlineTool(
  zoteroGateway: ZoteroGateway,
): AgentToolDefinition<SearchLiteratureOnlineInput, unknown> {
  const service = new LiteratureSearchService(zoteroGateway);
  return {
    spec: {
      name: "search_literature_online",
      description:
        "Search live scholarly sources or fetch canonical external metadata. Use workflow:'answer' to gather scholarly results for chat answers, or workflow:'review' for Zotero import/review-card workflows.",
      inputSchema: {
        type: "object",
        required: ["mode"],
        additionalProperties: false,
        properties: {
          workflow: {
            type: "string",
            enum: ["answer", "review"],
            description:
              "answer returns scholarly search results directly to the model for source-cited answers. review opens the Zotero review card for importing papers, saving notes, refining searches, or applying metadata.",
          },
          mode: {
            type: "string",
            enum: [
              "recommendations",
              "references",
              "citations",
              "search",
              "metadata",
            ],
          },
          source: {
            type: "string",
            enum: ["openalex", "arxiv", "europepmc"],
            description:
              "Search source. OpenAlex (default) supports all modes. arXiv (preprints, CS/ML/physics) and europepmc (biomedical) only support search mode.",
          },
          itemId: { type: "number" },
          paperContext: PAPER_CONTEXT_REF_SCHEMA,
          doi: { type: "string" },
          title: { type: "string" },
          arxivId: { type: "string" },
          query: { type: "string" },
          author: {
            type: "string",
            description:
              "Author name to filter results by. When provided alone (without query), returns the author's papers sorted by citation count. When combined with query, narrows keyword results to this author.",
          },
          limit: { type: "number" },
          libraryID: { type: "number" },
        },
      },
      mutability: "read",
      requiresConfirmation: false,
    },
    guidance: {
      matches: (request) =>
        /\b(related papers?|similar papers?|find papers?|search (the )?(internet|online|web|literature)|online search|web search|citations?|references?|papers? (by|from)|publications? (by|from))\b/i.test(
          request.userText,
        ),
      instruction:
        "When the user explicitly asks to search online or search the literature, use search_literature_online with workflow:'answer' by default so the model can answer from scholarly results and cite sources. Use workflow:'review' only when the user wants to import/add papers to Zotero, save selected search results to a note, refine results inside the card, or review metadata changes. Do not use this tool for questions about the content of papers already in context (e.g. counting references, summarizing, explaining)." +
        "\n\nSource selection:" +
        "\n• recommendations, references, citations modes → always use source:'openalex' (only OpenAlex supports these)." +
        "\n• search mode → source:'openalex' (default, broadest coverage), source:'arxiv' (preprints, CS/ML/physics), or source:'europepmc' (biomedical/life sciences)." +
        "\n\nAuthor search:" +
        "\n• When the user wants papers by a specific author, use the 'author' parameter (e.g. author:'Adrien Peyrache')." +
        "\n• You can combine 'author' with 'query' to find an author's papers on a specific topic." +
        "\n• Do NOT put author names in the 'query' parameter — use 'author' instead.",
    },
    presentation: {
      label: "Search Literature Online",
      summaries: {
        onCall: ({ args }) => {
          const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
          const mode = String(a.mode || "search");
          const author = typeof a.author === "string" ? a.author : undefined;
          const query = typeof a.query === "string" ? a.query : undefined;
          const detail = author && query ? `${query} by ${author}` : author || query || mode;
          return `Searching live literature (${detail})`;
        },
        onSuccess: ({ content }) => {
          const results =
            content &&
            typeof content === "object" &&
            Array.isArray((content as { results?: unknown[] }).results)
              ? (content as { results: unknown[] }).results
              : [];
          return results.length > 0
            ? `Found ${results.length} online result${results.length === 1 ? "" : "s"}`
            : "No online results found";
        },
        onPending: "Waiting for your review of the online search results",
        onApproved: "Review received - continuing with the selected literature action",
        onDenied: "Stopped after reviewing the online search results",
      },
    },
    validate: (args) => {
      if (!validateObject<Record<string, unknown>>(args)) {
        return fail("Expected an object");
      }
      const itemId = normalizePositiveInt(args.itemId);
      const mode =
        args.mode === "recommendations" ||
        args.mode === "references" ||
        args.mode === "citations" ||
        args.mode === "search" ||
        args.mode === "metadata"
          ? (args.mode as SearchLiteratureOnlineMode)
          : null;
      if (!mode) {
        return fail("mode is required");
      }
      const paperContext = validateObject<Record<string, unknown>>(args.paperContext)
        ? normalizeToolPaperContext(args.paperContext) || undefined
        : undefined;
      const query =
        typeof args.query === "string" && args.query.trim()
          ? args.query.trim()
          : undefined;
      const title =
        typeof args.title === "string" && args.title.trim()
          ? args.title.trim()
          : undefined;
      const doi =
        typeof args.doi === "string" && args.doi.trim()
          ? args.doi.trim()
          : undefined;
      const arxivId =
        typeof args.arxivId === "string" && args.arxivId.trim()
          ? args.arxivId.trim()
          : undefined;
      if (mode === "metadata" && !doi && !title && !arxivId && !query && !itemId && !paperContext) {
        return fail("metadata mode requires doi, title, arxivId, query, itemId, or paperContext");
      }
      const author =
        typeof args.author === "string" && args.author.trim()
          ? args.author.trim()
          : undefined;
      if (mode === "search" && !query && !title && !author) {
        return fail("search mode requires query, title, or author");
      }
      // Only OpenAlex supports recommendations, references, and citations.
      // Auto-correct source for these modes to prevent silent degradation.
      const requiresOpenAlex =
        mode === "recommendations" || mode === "references" || mode === "citations";
      const rawSource =
        args.source === "openalex" ||
        args.source === "arxiv" ||
        args.source === "europepmc"
          ? args.source
          : undefined;
      const source = requiresOpenAlex ? "openalex" : rawSource;
      const workflow =
        args.workflow === "review" || args.workflow === "answer"
          ? args.workflow
          : "answer";

      return ok<SearchLiteratureOnlineInput>({
        workflow,
        mode,
        source,
        itemId,
        paperContext,
        doi,
        title,
        arxivId,
        query,
        author,
        limit: normalizePositiveInt(args.limit),
        libraryID: normalizePositiveInt(args.libraryID),
      });
    },
    execute: async (input, context) => {
      const results = await service.execute(input, context);
      return {
        workflow: input.workflow,
        mode: input.mode,
        ...((results && typeof results === "object" ? results : { results }) as object),
      };
    },
    createResultReviewAction: (input, result, context) =>
      input.workflow === "review"
        ? createSearchLiteratureReviewAction(result, context, input)
        : null,
    resolveResultReview: (input, result, resolution, context) =>
      resolveSearchLiteratureReview(input, result, resolution, context),
  };
}
