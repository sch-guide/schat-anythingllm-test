import { Link, useMatch } from "react-router-dom";
import { BookOpenText } from "@phosphor-icons/react";
import paths from "@/utils/paths";

// 왼쪽 메뉴 "지침서 원본 보기" (지침서 퀴즈 아래). 로그인한 모든 사용자에게 보인다.
export default function GuidelineLink() {
  const active = !!useMatch(paths.guideline());
  return (
    <Link
      to={paths.guideline()}
      aria-current={active ? "page" : undefined}
      className={`schat-guideline-link flex h-[40px] items-center gap-x-2 rounded-lg pl-4 text-sm font-semibold text-white light:text-theme-text-primary transition-colors ${
        active
          ? "bg-[var(--theme-sidebar-thread-selected)] light:bg-blue-200"
          : "hover:bg-[var(--theme-sidebar-thread-selected)] light:hover:bg-slate-300"
      }`}
    >
      <BookOpenText size={22} className="text-sky-400 light:text-sky-700" />
      지침서 원본 보기
    </Link>
  );
}
