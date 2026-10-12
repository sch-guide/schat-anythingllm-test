import useSchatBrand from "@/hooks/useSchatBrand";

// 메뉴 맨 위 "SCHAT | 간호교육파트". 접기 버튼(약 248px 위치)과 겹치지 않도록
// 한 줄을 220px 안에 두고, 넘칠 만큼 긴 소속 표시만 글자를 줄인다.
const LINE_WIDTH = 220;
const SCHAT_AND_DIVIDER = 80;

export function affiliationFontSize(text = "", base = 13) {
  const length = Array.from(String(text)).length;
  if (!length) return base;
  const fit = Math.floor(((LINE_WIDTH - SCHAT_AND_DIVIDER) / length) * 10) / 10;
  return Math.max(9, Math.min(base, fit));
}

export default function SchatBrand({ compact = false }) {
  const { brand } = useSchatBrand();
  const affiliation = String(brand?.affiliation || "").trim();
  return (
    <div
      className={`flex items-center min-w-0 max-w-[220px] whitespace-nowrap ${compact ? "gap-2" : "gap-2.5"}`}
      aria-label={affiliation ? `SCHAT 홈, ${affiliation}` : "SCHAT 홈"}
      data-testid="schat-brand-line"
    >
      <span
        className={`${
          compact ? "text-lg" : "text-base"
        } shrink-0 font-semibold tracking-[0.04em] text-white light:text-slate-900`}
      >
        SCHAT
      </span>
      {affiliation && (
        <>
          <span
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-slate-300"
            data-testid="schat-brand-divider"
          />
          <span
            className="min-w-0 overflow-hidden font-semibold text-[#8fb3e8] light:text-[#24549c]"
            style={{ fontSize: `${affiliationFontSize(affiliation)}px` }}
            data-testid="schat-brand-affiliation"
          >
            {affiliation}
          </span>
        </>
      )}
    </div>
  );
}
