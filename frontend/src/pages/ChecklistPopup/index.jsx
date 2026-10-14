import ChecklistPrintButton from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistPrintButton";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Checklist from "@/models/checklist";
import ChecklistTree from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree";
import ChecklistResetButton from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistResetButton";
import ChecklistLeftoverNotice from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistLeftoverNotice";
import useChecklistPersonalState from "@/hooks/useChecklistPersonalState";
import ChecklistPersonalStatus from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistPersonalStatus";
import ChecklistMemo from "@/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistMemo";

/**
 * Standalone checklist window opened with window.open(). It loads the
 * checklist itself so it keeps working while the main SCHAT window is
 * minimized, navigated or closed. Checks are saved per user and checklist
 * (shared with the floating panel); fold state lives until the window closes.
 */
export default function ChecklistPopup() {
  const { slug, checklistId } = useParams();
  const [checklist, setChecklist] = useState(null);
  const [status, setStatus] = useState("loading");
  const {
    checkedItems,
    setCheckedItems,
    resetCheckedItems,
    leftover,
    dismissLeftover,
    patientInfo,
    otherMemo,
    setMemoField,
    flush,
    disabled,
    error,
    reload,
    remaining,
    localOnly,
    savedChecklist,
    rememberChecklist,
  } = useChecklistPersonalState(checklistId, true, true);
  const [expandedSections, setExpandedSections] = useState({});

  useEffect(() => {
    if (localOnly) {
      setChecklist(savedChecklist || null);
      setStatus(savedChecklist ? "ready" : "unavailable");
      return;
    }
    let active = true;
    Checklist.list(slug).then((items) => {
      if (!active) return;
      const found = items.find((item) => item.id === checklistId) || null;
      setChecklist(found);
      if (found) rememberChecklist(found);
      setStatus(found ? "ready" : "unavailable");
    });
    return () => {
      active = false;
    };
  }, [slug, checklistId, localOnly]);

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
            {localOnly && (
              <p className="m-0 mb-1 text-xs text-zinc-400 light:text-slate-500">
                로그아웃됨 · 이 PC에만 저장
              </p>
            )}
            <div className="flex items-center gap-2">
              <h1 className="m-0 min-w-0 flex-1 text-base font-semibold text-zinc-50 light:text-slate-900">
                {checklist.title} 체크리스트
              </h1>
              <ChecklistPrintButton
            checklist={checklist} checkedItems={checkedItems}
            patientInfo={patientInfo} otherMemo={otherMemo} disabled={disabled}
          />
              <ChecklistResetButton
                checkedItems={checkedItems}
                onReset={resetCheckedItems}
              />
            </div>
            <p className="m-0 mt-1 text-xs text-zinc-400 light:text-slate-600">
              {checklist.source?.filename || ""}
            </p>
          </header>
          {leftover && (
            <div className="shrink-0 pt-3">
              <ChecklistLeftoverNotice
                leftover={leftover}
                onDismiss={dismissLeftover}
              />
            </div>
          )}
          <ChecklistPersonalStatus
            error={error}
            reload={reload}
            remaining={remaining}
          />
          <fieldset
            disabled={disabled}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto border-0 px-3 py-4"
          >
            <ChecklistMemo
              id="patient"
              title="환자정보"
              compact
              placeholder="예: 홍길동"
              hint="환자등록번호 및 호실은 적지 마세요"
              value={patientInfo}
              onChange={(value) => setMemoField("patient", value)}
              onBlur={flush}
            />
            <ChecklistTree
              checklist={checklist}
              tone="blue"
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
            <ChecklistMemo
              id="other"
              title="기타메모"
              placeholder="추가로 기록할 내용을 입력하세요"
              value={otherMemo}
              onChange={(value) => setMemoField("other", value)}
              onBlur={flush}
            />
          </fieldset>
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
