import { useEffect, useState } from "react";

// 한 번 받은 원본은 이 화면에 있는 동안 다시 받지 않는다(최근 3개까지).
const cache = new Map();
const CACHE_LIMIT = 3;

export function browserViewerUrl(objectUrl, page) {
  if (!objectUrl) return "";
  const value = Math.trunc(Number(page));
  return `${objectUrl}#page=${Number.isFinite(value) && value > 0 ? value : 1}&view=FitH`;
}

async function loadObjectUrl(source) {
  if (cache.has(source.url)) return cache.get(source.url);
  const response = await fetch(source.url, {
    headers: source.httpHeaders,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("원본을 열지 못했습니다.");
  const blob = await response.blob();
  if (blob.type && blob.type !== "application/pdf") throw new Error("PDF가 아닙니다.");
  const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
  cache.set(source.url, url);
  while (cache.size > CACHE_LIMIT) {
    const [oldest, oldUrl] = cache.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    cache.delete(oldest);
  }
  return url;
}

/**
 * PC용 지침서 원본 보기: 브라우저에 들어 있는 PDF 보기 화면을 그대로 쓴다.
 * 쪽 미리보기·목차, 확대, 쪽 번호, 원본 안 글자 찾기(돋보기, Ctrl+F)를 브라우저가 제공한다.
 */
export default function GuidelineBrowserViewer({ source, title, jump = null }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setObjectUrl("");
    loadObjectUrl(source)
      .then((url) => {
        if (!active) return;
        setObjectUrl(url);
        setStatus("ready");
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url]);

  if (status === "error")
    return (
      <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
        지침서를 열지 못했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );
  if (status === "loading")
    return (
      <div
        role="status"
        className="flex h-[78vh] min-h-[480px] w-full items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 text-sm text-zinc-400 light:border-slate-300 light:bg-slate-100 light:text-slate-600"
      >
        원본을 불러오는 중입니다. 큰 문서는 몇 초 걸릴 수 있습니다.
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-zinc-400 light:text-slate-500">
        원본 안에서 찾으려면 보기 화면 위쪽 돋보기를 누르거나 Ctrl+F를 누르세요.
      </p>
      <iframe
        // 쪽 이동(검색 결과 선택) 때마다 해당 쪽으로 다시 연다. 원본은 다시 받지 않는다.
        key={`${objectUrl}:${jump?.page || 1}:${jump?.at || 0}`}
        title={title || "지침서 원본"}
        aria-label={`${title || "지침서"} 원본`}
        src={browserViewerUrl(objectUrl, jump?.page)}
        className="h-[78vh] min-h-[480px] w-full rounded-lg border border-zinc-700 bg-white light:border-slate-300"
      />
    </div>
  );
}
