import { Link, useMatch } from "react-router-dom";
import paths from "@/utils/paths";
import QuizIcon from "./QuizIcon";

// Sidebar entry above 이용 가이드. Visible to every signed-in user.
export default function QuizLink() {
  const active = !!useMatch(paths.quiz());
  return (
    <Link
      to={paths.quiz()}
      aria-current={active ? "page" : undefined}
      className={`schat-quiz-link flex h-[40px] items-center gap-x-2 rounded-lg pl-4 text-sm font-semibold text-white light:text-theme-text-primary transition-colors ${
        active
          ? "bg-[var(--theme-sidebar-thread-selected)] light:bg-blue-200"
          : "hover:bg-[var(--theme-sidebar-thread-selected)] light:hover:bg-slate-300"
      }`}
    >
      <QuizIcon size={22} className="text-sky-400 light:text-sky-700" />
      지침서 퀴즈
    </Link>
  );
}
