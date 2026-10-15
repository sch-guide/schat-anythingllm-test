import { useEffect, useMemo, useState } from "react";
import { isMobile } from "react-device-detect";
import { BookOpenText } from "@phosphor-icons/react";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import Workspace from "@/models/workspace";
import Guideline from "@/models/guideline";
import GuidelinePdfViewer from "@/components/SchatGuideline/GuidelinePdfViewer";
import GuidelineBrowserViewer from "@/components/SchatGuideline/GuidelineBrowserViewer";

// 지침서 원본 보기 (직원). 관리자가 '지침서 원본 자료'에 올린 PDF를 화면에서 본다.
// 챗봇용 문서는 여기에 보이지 않는다. PC는 브라우저 PDF 보기(원본 안 찾기·쪽 미리보기), 휴대폰은 쪽 단위 보기.
export default function GuidelinePage() {
  return (
    <div className="schat-app-bg w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      {!isMobile ? <Sidebar /> : <SidebarMobileHeader />}
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="schat-chat-panel relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-y-auto border-none light:border-solid light:border light:border-theme-modal-border"
      >
        <GuidelineLibrary />
      </div>
    </div>
  );
}

const keyOf = (doc) => `${doc.kind}:${doc.ref}`;
const nameOf = (title = "") => title.replace(/\.pdf$/i, "");

export function GuidelineList({ documents, selected, onSelect }) {
  if (!documents.length)
    return (
      <p className="text-sm text-zinc-400 light:text-slate-500">
        아직 올라온 지침서가 없습니다. 관리자가 올리면 여기에 보입니다.
      </p>
    );
  return (
    <ul className="flex flex-col gap-2">
      {documents.map((doc) => (
        <li key={keyOf(doc)}>
          <button
            type="button"
            aria-pressed={selected === keyOf(doc)}
            onClick={() => onSelect(doc)}
            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
              selected === keyOf(doc)
                ? "border-sky-500 bg-sky-500/10 text-white light:text-slate-900"
                : "border-zinc-700 text-zinc-200 hover:border-sky-500 light:border-slate-200 light:text-slate-700"
            }`}
          >
            <span className="block break-words font-semibold">{nameOf(doc.title)}</span>
            <span className="text-xs text-zinc-400 light:text-slate-500">
              {doc.pageCount > 0 ? `${doc.pageCount}쪽` : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GuidelineLibrary() {
  const [slug, setSlug] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [jump, setJump] = useState(null);

  useEffect(() => {
    let active = true;
    Workspace.all()
      .then((workspaces) => {
        const first = Array.isArray(workspaces) ? workspaces[0] : null;
        if (!first?.slug) throw new Error("no workspace");
        if (!active) return;
        setSlug(first.slug);
        return Guideline.documents(first.slug);
      })
      .then((list) => active && list && setDocuments(list))
      .catch(() => active && setError("지침서 목록을 불러오지 못했습니다."));
    return () => {
      active = false;
    };
  }, []);

  const current = documents?.find((doc) => keyOf(doc) === selected) || null;
  const source = useMemo(
    () => (slug && current ? Guideline.source(slug, current) : null),
    [slug, current?.kind, current?.ref]
  );

  function open(doc, page = 1) {
    setSelected(keyOf(doc));
    setJump({ page, at: Date.now() });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-6 md:px-8">
      <header className="flex items-center gap-2">
        <BookOpenText size={26} className="text-sky-400 light:text-sky-700" />
        <h1 className="text-xl font-semibold text-white light:text-slate-900">지침서 원본 보기</h1>
      </header>
      <p className="text-sm text-zinc-400 light:text-slate-500">
        관리자가 올린 지침서 원본을 볼 수 있습니다. 원본 안에서 찾을 때는 보기 화면의 돋보기나 Ctrl+F를 쓰세요.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      {!documents && !error && (
        <p role="status" className="text-sm text-zinc-400 light:text-slate-500">
          지침서 목록을 불러오는 중입니다.
        </p>
      )}
      {documents && (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          <div className={current && isMobile ? "hidden" : ""}>
            <GuidelineList documents={documents} selected={selected} onSelect={(doc) => open(doc, 1)} />
          </div>
          <div className="min-w-0">
            {current && source ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {isMobile && (
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-lg border border-zinc-600 px-3 py-1.5 text-sm text-zinc-100 light:border-slate-300 light:text-slate-700"
                    >
                      목록
                    </button>
                  )}
                  <h2 className="min-w-0 truncate text-base font-semibold text-white light:text-slate-900" title={current.title}>
                    {nameOf(current.title)}
                  </h2>
                </div>
                {/* PC는 브라우저 PDF 보기(쪽 미리보기·원본 안 찾기), 휴대폰은 쪽 단위 보기 */}
                {isMobile ? (
                  <GuidelinePdfViewer source={source} title={current.title} jump={jump} />
                ) : (
                  <GuidelineBrowserViewer source={source} title={current.title} jump={jump} />
                )}
              </div>
            ) : (
              documents.length > 0 && (
                <p className="text-sm text-zinc-400 light:text-slate-500">
                  왼쪽(모바일은 위) 목록에서 지침서를 골라 주세요.
                </p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
