const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const endpointSource = fs.readFileSync(
  path.resolve(__dirname, "../../endpoints/workspaces.js"),
  "utf8"
);

test("workspace checklist read route uses workspace authorization and public presentation", () => {
  assert.match(endpointSource, /"\/workspace\/:slug\/checklists"/);
  assert.match(endpointSource, /flexUserRoleValid\(\[ROLES\.all\]\)/);
  assert.match(endpointSource, /Document\.forWorkspace\(workspace\.id\)/);
  assert.match(endpointSource, /workspaceDocumentIds\(documents\)/);
  assert.match(endpointSource, /toPublicChecklist/);
});

test("workspace checklist update route is admin-manager only and verifies document membership", () => {
  assert.match(endpointSource, /"\/workspace\/:slug\/checklists\/:checklistId"/);
  assert.match(
    endpointSource,
    /flexUserRoleValid\(\[ROLES\.admin, ROLES\.manager\]\)/
  );
  assert.match(endpointSource, /allowedDocumentIds\.has\(checklist\.documentId\)/);
  assert.match(endpointSource, /ChecklistRepository\.updateChecklist/);
});

test("checklist endpoints do not expose internal document identifiers", () => {
  assert.doesNotMatch(endpointSource, /json\(\{[^}]*documentId/s);
});
