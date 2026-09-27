import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Checklist from "@/models/checklist";
import ChecklistTree from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree";

/**
 * Standalone checklist window opened with window.open(). It loads the
 * checklist itself so it keeps working while the main SCHAT window is
 * minimized, navigated or closed. Checks and fold state live until this
 * window is closed; nothing is persisted.
 */
export default function ChecklistPopup() {
  const { slug, checklistId } = useParams();
  const [checklist, setChecklist] = useState(null);
  const [status, setStatus] = useState("loading");
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedSections, setExpandedSections] = useState({});

  useEffect(() => {
    let active = true;
    Checklist.list(slug).then((items) => {
      if (!active) return;
      const found = items.find((item) => item.id === checklistId) || null;
      setChecklist(found);
      setStatus(found ? "ready" : "unavailable");
    });
    return () => {
      active = false;
    };
  }, [slug, checklistId]);

  useEffect(() => {
    document.title = checklist
      ? `${checklist.title} 체크리스트`
      : "SCHAT 체크리스트";
  }, [checklist]);

  return (
    <main
      aria-label="체크리스트 별도 창"
      className="flex h-screen w-full flex-col overflow-hidden bg-zinc-900 text-white light:bg-white light:text-slate-900"
    >
      {status === "ready" ? (
        <>
          <header className="shrink-0 border-b border-zinc-700 px-4 py-3 light:border-slate-200">
            <h1 className="m-0 text-base font-semibold text-zinc-50 light:text-slate-900">
              {checklist.title} 체크리스트
            </h1>
            <p className="m-0 mt-1 text-xs text-zinc-400 light:text-slate-600">
              {checklist.source?.filename || ""} · p.
              {checklist.source?.page || "-"}
            </p>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
            <ChecklistTree
              checklist={checklist}
              checkedItems={checkedItems}
              onCheckedChange={setCheckedItems}
              expandedSections={expandedSections}
              onToggleSection={(sectionId, expanded) =>
                setExpandedSections((current) => ({
                  ...current,
                  [sectionId]: !expanded,
                }))
              }
            />
          </div>
        </>
      ) : (
        <p className="m-auto px-6 text-center text-sm text-zinc-300 light:text-slate-600">
          {status === "loading"
            ? "체크리스트를 불러오는 중입니다."
            : "체크리스트를 불러오지 못했습니다. SCHAT에 로그인한 뒤 다시 열어주세요."}
        </p>
      )}
    </main>
  );
}
