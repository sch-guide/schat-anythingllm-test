import { Link, useMatch } from "react-router-dom";
import paths from "@/utils/paths";
import GuideIcon from "./GuideIcon";

// Sidebar entry under "+ 새 대화". Visible to every signed-in user.
export default function GuideLink() {
  const active = !!useMatch(paths.guide());
  return (
    <Link
      to={paths.guide()}
      aria-current={active ? "page" : undefined}
      className={`schat-guide-link flex h-[40px] items-center gap-x-2 rounded-lg pl-4 text-sm font-semibold text-white light:text-theme-text-primary transition-colors ${
        active
          ? "bg-[var(--theme-sidebar-thread-selected)] light:bg-blue-200"
          : "hover:bg-[var(--theme-sidebar-thread-selected)] light:hover:bg-slate-300"
      }`}
    >
      <GuideIcon size={22} />
      이용 가이드
    </Link>
  );
}
