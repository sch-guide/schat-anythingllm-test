import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("administrator view and edit share the employee tree in one screen", () => {
  const editor = source(
    "../../../../Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistEditor.jsx"
  );
  assert.match(editor, /<ChecklistTree/);
  assert.match(editor, /edit=\{editing \? edit : null\}/);
  assert.match(editor, /체크리스트 보기/);
  assert.match(editor, /체크리스트 수정/);
  assert.match(editor, /원본 보기 p\.\{source\.page\}/);
  assert.match(editor, /max-h-\[70vh\]/);
  assert.match(editor, /size="lg"/);
});

test("employee launcher delegates opening to the persistent chat-history panel", () => {
  const launcher = source("./ChecklistLauncher.jsx");
  assert.match(launcher, /onOpenChecklist/);
  assert.doesNotMatch(launcher, /ChecklistModal|checkedItems|openChecklistId/);
  assert.match(launcher, /체크리스트 보기/);
});

test("floating employee panel supports portal drag resize minimize and explicit close without overlay", () => {
  const panel = source("./ChecklistFloatingPanel.jsx");
  assert.match(panel, /createPortal/);
  assert.match(panel, /onPointerDown/);
  assert.match(panel, /setPosition/);
  assert.match(panel, /setSize/);
  assert.match(panel, /minWidth/);
  assert.match(panel, /minHeight/);
  assert.match(panel, /setMinimized/);
  assert.match(panel, /onClose/);
  assert.match(panel, /fixed/);
  assert.doesNotMatch(panel, /backdrop|bg-black\/60/);
});

test("floating panel resizes from the right edge, bottom edge and corner without clamping position", () => {
  const panel = source("./ChecklistFloatingPanel.jsx");
  assert.match(panel, /cursor-ew-resize/);
  assert.match(panel, /cursor-ns-resize/);
  assert.match(panel, /cursor-se-resize/);
  assert.match(panel, /edges\.right/);
  assert.match(panel, /edges\.bottom/);
  assert.doesNotMatch(panel, /innerHeight|Math\.min\(\s*window/);
});

test("chat history owns the employee panel so message replacement does not reset working state", () => {
  const history = source("../index.jsx");
  assert.match(history, /ChecklistFloatingPanel/);
  assert.match(history, /openChecklistIds/);
  assert.match(history, /mountedChecklistIds\.map/);
  assert.match(history, /key=\{checklistId\}/);
  assert.match(history, /onFocus=\{focusChecklist\}/);
  assert.match(history, /onOpenChecklist/);
  assert.match(history, /<ChecklistFloatingPanel/);
  assert.ok(
    history.indexOf("<ChecklistFloatingPanel") <
      history.indexOf("</MessageActionsProvider>")
  );
});

test("streaming and historical replies render checklist before citations", () => {
  for (const relativePath of [
    "../PromptReply/index.jsx",
    "../HistoricalMessage/index.jsx",
  ]) {
    const reply = source(relativePath);
    assert.match(reply, /ChecklistLauncher/);
    assert.match(reply, /onOpenChecklist/);
    assert.ok(
      reply.indexOf("<ChecklistLauncher") < reply.indexOf("<Citations")
    );
  }
});

test("chat history associates assistant replies with the preceding user question", () => {
  const history = source("../index.jsx");
  assert.match(history, /questionForAssistant/);
  assert.match(history, /matchChecklists/);
  assert.match(
    history,
    /matchChecklists\(questionForAssistant\(history, index\), checklists\)/
  );
  assert.match(history, /Checklist\.list/);
});

test("employee panel keeps fold and check state in the panel and uses the hierarchical tree", () => {
  const panel = source("./ChecklistFloatingPanel.jsx");
  assert.match(panel, /<ChecklistTree/);
  assert.doesNotMatch(panel, /ChecklistBody/);
  assert.match(panel, /expandedSections=\{expandedSections\}/);
  assert.match(panel, /onCheckedChange=\{setCheckedItems\}/);
  assert.match(panel, /onPopOut/);
});

test("the old flat administrator body is gone so there is one checklist layout", () => {
  const controls = source(
    "../../../../Modals/ManageWorkspace/Documents/WorkspaceDirectory/OriginalPdfRow/ChecklistControls.jsx"
  );
  assert.doesNotMatch(controls, /ChecklistModal|ChecklistBody/);
});

test("employee tree renders read-only rows, parent/child checkboxes, indeterminate and strike-through", () => {
  const tree = source("./ChecklistTree.jsx");
  assert.match(tree, /isInformationalItem\(item\)/);
  assert.match(tree, /\.indeterminate = state === "indeterminate"/);
  assert.match(tree, /toggleParent\(scope, item, checkedItems\)/);
  assert.match(tree, /toggleDetail\(scope, item, index, checkedItems\)/);
  assert.match(tree, /checklistId: checklist\.id, sectionId: section\.id/);
  assert.match(tree, /isCheckableDetail\(item, index\)/);
  assert.match(tree, /line-through/);
});

test("launcher offers the floating panel by default and a desktop-only separate window", () => {
  const launcher = source("./ChecklistLauncher.jsx");
  const history = source("../index.jsx");
  assert.match(launcher, /onOpenChecklist\?\.\(checklist\.id\)/);
  assert.match(launcher, /onOpenChecklist\?\.\(checklist\.id, "window"\)/);
  assert.match(launcher, /hidden[^"]*md:inline-flex/);
  assert.match(history, /openChecklistPopup/);
});

test("separate checklist window is a standalone route that loads its own data", () => {
  const popup = source("../../../../../pages/ChecklistPopup/index.jsx");
  const main = source("../../../../../main.jsx");
  const util = source("../../../../../utils/checklistPopup.js");
  assert.match(popup, /Checklist\.list\(slug\)/);
  assert.match(popup, /<ChecklistTree/);
  assert.match(main, /\/workspace\/:slug\/checklist\/:checklistId/);
  assert.match(util, /window\.open\(/);
  assert.match(util, /popup=yes/);
});

test("each checklist panel keeps its own position and stacking so several can be open", () => {
  const panel = source("./ChecklistFloatingPanel.jsx");
  assert.match(panel, /cascadeIndex \* 28/);
  assert.match(panel, /zIndex \}/);
  assert.match(
    panel,
    /onPointerDownCapture=\{\(\) => onFocus\?\.\(checklist\.id\)\}/
  );
});
