import { useEffect, useRef, useState } from "react";
import { isMobile } from "react-device-detect";
import { CaretDown, MagnifyingGlass } from "@phosphor-icons/react";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import SchatAccount from "@/models/schatAccount";
import GuideIcon from "@/components/SchatGuide/GuideIcon";
import ReportModal from "@/components/SchatAccount/ReportModal";

// 이용 가이드: the admin-approved FAQ items (same data the report form suggests),
// searchable by staff. Local keyword search only; no AI call.
export default function GuidePage() {
  return (
    <div className="schat-app-bg w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      {!isMobile ? <Sidebar /> : <SidebarMobileHeader />}
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="schat-chat-panel relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-zinc-900 light:bg-white w-full h-full overflow-y-auto border-none light:border-solid light:border light:border-theme-modal-border"
      >
        <Guide />
      </div>
    </div>
  );
}

function Guide() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [voted, setVoted] = useState({});
  const [reportFaq, setReportFaq] = useState(null);
  const viewed = useRef(new Set());

  // Category chips come from the items that actually exist.
  useEffect(() => {
    SchatAccount.guide().then((r) =>
      setAllCategories([...new Set((r?.items || []).map((i) => i.category))])
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const r = await SchatAccount.guide({ q, category });
      setItems(r?.items || []);
    }, 200);
    return () => clearTimeout(timer);
  }, [q, category]);

  function toggle(item) {
    const next = openId === item.id ? null : item.id;
    setOpenId(next);
    if (next && !viewed.current.has(item.id)) {
      viewed.current.add(item.id);
      SchatAccount.guideFeedback(item.id, "view");
    }
  }

  function vote(item, type) {
    if (voted[item.id]) return;
    setVoted((prev) => ({ ...prev, [item.id]: type }));
    SchatAccount.guideFeedback(item.id, type);
    if (type === "not_helpful") setReportFaq(item);
  }

  return (
    <div className="schat-guide mx-auto w-full max-w-[760px] px-4 md:px-8 pt-16 md:pt-12 pb-16 flex flex-col gap-y-5">
      <header className="flex items-start gap-x-3">
        <GuideIcon size={40} />
        <div>
          <h1 className="text-xl font-bold text-white light:text-slate-900">
            이용 가이드
          </h1>
          <p className="text-sm text-zinc-400 light:text-slate-500">
            필요한 해결 방법을 빠르게 찾아보세요.
          </p>
        </div>
      </header>

      <div className="schat-guide-search relative">
        <MagnifyingGlass
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 light:text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="해결 방법 검색"
          aria-label="해결 방법 검색"
          className="w-full h-[42px] rounded-xl pl-9 pr-3 text-sm outline-none bg-zinc-800 light:bg-slate-50 text-white light:text-slate-900 border border-zinc-700 light:border-slate-300 focus:border-sky-500"
        />
      </div>

      {allCategories.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="분류">
          {["", ...allCategories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={`schat-guide-chip rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                category === c
                  ? "bg-sky-700 border-sky-700 text-white light:bg-sky-600 light:border-sky-600"
                  : "border-zinc-700 text-zinc-300 hover:border-sky-500 light:border-slate-300 light:text-slate-600"
              }`}
            >
              {c || "전체"}
            </button>
          ))}
        </div>
      )}

      {items === null ? (
        <p className="text-sm text-zinc-400 light:text-slate-500">
          불러오는 중...
        </p>
      ) : items.length === 0 ? (
        <p className="schat-guide-empty rounded-xl border border-dashed border-zinc-700 light:border-slate-300 px-4 py-8 text-center text-sm text-zinc-400 light:text-slate-500">
          {q || category
            ? "검색 결과가 없습니다."
            : "등록된 이용 가이드가 없습니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-y-2">
          {items.map((item) => {
            const open = openId === item.id;
            return (
              <li
                key={item.id}
                className="schat-guide-item rounded-xl border border-zinc-700 light:border-slate-200 overflow-hidden"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(item)}
                  className="w-full flex items-center gap-x-3 px-4 py-3 text-left hover:bg-zinc-800/60 light:hover:bg-slate-50"
                >
                  <span className="schat-guide-q shrink-0 text-xs font-bold text-sky-400 light:text-sky-700">
                    Q
                  </span>
                  <span className="flex-1 text-sm font-medium text-white light:text-slate-900">
                    {item.title}
                  </span>
                  <span className="hidden sm:inline text-xs text-zinc-500 light:text-slate-400">
                    {item.category}
                  </span>
                  <CaretDown
                    size={16}
                    className={`shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <div className="px-4 pb-4 flex flex-col gap-y-3 border-t border-zinc-800 light:border-slate-100 pt-3">
                    {item.problem && (
                      <p className="text-sm text-zinc-400 light:text-slate-500 whitespace-pre-wrap">
                        {item.problem}
                      </p>
                    )}
                    <div className="flex gap-x-3">
                      <span className="schat-guide-a shrink-0 text-xs font-bold text-emerald-400 light:text-emerald-700">
                        A
                      </span>
                      <p className="text-sm text-zinc-100 light:text-slate-800 whitespace-pre-wrap">
                        {item.solution}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-zinc-400 light:text-slate-500">
                        도움이 되었나요?
                      </span>
                      {voted[item.id] === "helpful" ? (
                        <span className="text-xs text-emerald-400 light:text-emerald-700">
                          의견 감사합니다.
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={!!voted[item.id]}
                            onClick={() => vote(item, "helpful")}
                            className="rounded-lg border border-zinc-700 light:border-slate-300 px-3 py-1.5 text-xs text-zinc-200 light:text-slate-700 hover:border-sky-500 disabled:opacity-50"
                          >
                            도움이 됐어요
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              voted[item.id]
                                ? setReportFaq(item)
                                : vote(item, "not_helpful")
                            }
                            className="rounded-lg border border-zinc-700 light:border-slate-300 px-3 py-1.5 text-xs text-zinc-200 light:text-slate-700 hover:border-sky-500"
                          >
                            해결되지 않았어요 · 문제 신고
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ReportModal
        isOpen={!!reportFaq}
        relatedFaq={reportFaq}
        onClose={() => setReportFaq(null)}
      />
    </div>
  );
}
