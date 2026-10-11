import test from "node:test";
import assert from "node:assert/strict";
import * as review from "./synonymReview.js";

const groups = [
  {
    id: 1,
    terms: ["관", "tube"],
    status: "active",
    source: "admin",
    pendingAdditions: [{ id: 11, terms: ["catheter"], status: "pending" }],
  },
  {
    id: 2,
    terms: ["생검", "biopsy"],
    status: "needs_review",
    source: "auto",
    suggestion: { id: 12, status: "pending" },
  },
  { id: 3, terms: ["투석", "HD"], status: "needs_review", source: "draft" },
  {
    id: 4,
    terms: ["흉관", "chest tube"],
    status: "off",
    source: "auto",
    suggestion: { id: 13, status: "approved" },
  },
];

test("one-screen view separates automatic proposals from editable manual drafts", () => {
  const view = review.managementView(groups);
  assert.deepEqual(
    view.newGroups.map((row) => row.id),
    [2]
  );
  assert.deepEqual(
    view.mainGroups.map((row) => row.id),
    [1, 3, 4]
  );
  assert.equal(view.total, 4);
  assert.equal(view.aiCount, 2);
});

test("search and AI filter determine the exact visible pending bulk proposal IDs", () => {
  const searched = review.managementView(groups, "CATHeTer", true);
  assert.deepEqual(
    searched.mainGroups.map((row) => row.id),
    [1]
  );
  assert.deepEqual(searched.proposalIds, [11]);
  const ai = review.managementView(groups, "", true);
  assert.deepEqual(
    ai.mainGroups.map((row) => row.id),
    [1]
  );
  assert.deepEqual(ai.proposalIds, [11, 12]);
  assert.deepEqual(
    review.managementView(groups, "HD").mainGroups.map((row) => row.id),
    [3]
  );
});

test("client validation rejects repeated words, short groups and newly overlapping words", () => {
  assert.equal(
    review.validateTerms(["one"], groups),
    "단어를 2개 이상 넣어 주세요."
  );
  assert.match(review.validateTerms([" A ", "a", "b"], groups), /같은 단어/);
  assert.equal(
    review.validateTerms([" TUBE ", "new"], groups),
    "관 묶음에 이미 있어요."
  );
  assert.equal(
    review.validateTerms(["관", "tube", "line"], groups, groups[0]),
    ""
  );
  assert.equal(review.validateTerms(["새말", "new"], groups), "");
  assert.match(
    review.validateTerms(["관 삽입", "tube removal"], groups),
    /서로 다른 시술/
  );
});

test("client validation permits inherited overlap during kind/status edits", () => {
  const legacy = {
    id: 9,
    terms: ["HD", "혈액투석"],
    source: "draft",
    status: "off",
  };
  assert.equal(
    review.validateTerms(
      ["HD", "혈액투석", "hemodialysis"],
      [...groups, legacy],
      legacy
    ),
    ""
  );
  assert.equal(
    review.validateTerms(["HD", "tube"], [...groups, legacy], legacy),
    "관 묶음에 이미 있어요."
  );
});

test("safe source viewer accepts only opaque PDF references paired with a workspace", () => {
  assert.equal(
    review.canOpenSource({
      pdfRef: "a".repeat(43),
      workspaceSlug: "synthetic",
      missing: false,
      originalPdfAvailable: true,
    }),
    true
  );
  for (const source of [
    {
      pdfRef: "../../secret.pdf",
      workspaceSlug: "synthetic",
      originalPdfAvailable: true,
    },
    { pdfRef: "a".repeat(43), originalPdfAvailable: true },
    {
      pdfRef: "a".repeat(43),
      workspaceSlug: "synthetic",
      missing: true,
      originalPdfAvailable: true,
    },
  ])
    assert.equal(review.canOpenSource(source), false);
});

test("dismissed new AI groups stay stored but disappear from both lists and counts", () => {
  const rejected = {
    id: 5,
    terms: ["신루", "nephrostomy"],
    source: "auto",
    status: "off",
    suggestion: { id: 14, status: "dismissed" },
  };
  const view = review.managementView([...groups, rejected]);
  assert.deepEqual(
    view.mainGroups.map((row) => row.id),
    [1, 3, 4]
  );
  assert.equal(view.total, 4);
  assert.deepEqual(view.proposalIds, [11, 12]);
});

test("client permits human replacement of a hidden rejected AI group only", () => {
  const rejected = {
    id: 5,
    terms: ["신루", "nephrostomy"],
    source: "auto",
    status: "off",
    suggestion: { id: 14, type: "group", status: "dismissed" },
  };
  assert.equal(
    review.validateTerms(["신루", "신루관"], [...groups, rejected]),
    ""
  );
  assert.equal(
    review.validateTerms(["흉관", "thoracic tube"], groups),
    "흉관 묶음에 이미 있어요."
  );
});
