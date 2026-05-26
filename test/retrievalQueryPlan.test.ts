import { assert } from "chai";
import {
  buildRetrievalQueryPlan,
  RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT,
  resolveRetrievalQueryPlan,
  shouldAutoGenerateQueryVariants,
} from "../src/modules/contextPanel/retrievalQueryPlan";

describe("retrievalQueryPlan", function () {
  it("dedupes and caps query variants while preserving the original query", function () {
    const plan = buildRetrievalQueryPlan({
      query: "哪些论文使用钙成像研究表征漂移？",
      queryVariants: [
        "calcium imaging representational drift",
        "calcium imaging representational drift",
        "Ca2+ imaging representational drift",
        "two-photon imaging representational drift",
        "one-photon miniscope representational drift",
        "GCaMP representational drift",
        "chronic calcium imaging neural drift",
        "extra variant beyond default cap",
      ],
    });

    assert.equal(plan.originalQuery, "哪些论文使用钙成像研究表征漂移？");
    assert.lengthOf(plan.variants, RETRIEVAL_QUERY_VARIANT_DEFAULT_LIMIT);
    assert.isTrue(plan.variantLimitHit);
    assert.equal(plan.effectiveQueries[0], plan.originalQuery);
    assert.include(
      plan.effectiveQueries,
      "Ca2+ imaging representational drift",
    );
    assert.include(plan.lexicalTerms, "calcium");
    assert.include(plan.semanticQuery, plan.originalQuery);
  });

  it("skips automatic planning for exact lookup-style queries", function () {
    assert.isFalse(
      shouldAutoGenerateQueryVariants({
        query: "find DOI 10.1101/2024.01.01.123456",
        hasRetrievalContext: true,
      }),
    );
    assert.isFalse(
      shouldAutoGenerateQueryVariants({
        query: "find the exact quote 'calcium imaging'",
        hasRetrievalContext: true,
      }),
    );
    assert.isTrue(
      shouldAutoGenerateQueryVariants({
        query: "how did they measure representational stability?",
        hasRetrievalContext: true,
      }),
    );
  });

  it("resolves caller-provided variants without requiring model planning", async function () {
    const plan = await resolveRetrievalQueryPlan({
      query: "表征漂移",
      queryVariants: ["representational drift"],
      hasRetrievalContext: true,
    });

    assert.deepEqual(plan.variants, ["representational drift"]);
    assert.include(plan.notes.join("\n"), "provided by the caller");
  });

  it("falls back to original-only planning when no model config is available", async function () {
    const plan = await resolveRetrievalQueryPlan({
      query: "how did they measure representational stability?",
      hasRetrievalContext: true,
    });

    assert.deepEqual(plan.variants, []);
    assert.deepEqual(plan.effectiveQueries, [
      "how did they measure representational stability?",
    ]);
    assert.include(plan.notes.join("\n"), "No query variants were used");
  });
});
