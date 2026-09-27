import { Moon } from "@phosphor-icons/react";
import { useTheme } from "@/hooks/useTheme";

export default function DarkModeRow() {
  const { isLight, setTheme } = useTheme();
  const isDark = !isLight;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={() => setTheme(isLight ? "dark" : "light")}
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm font-normal text-zinc-50 transition-colors hover:bg-zinc-700 light:text-slate-800 light:hover:bg-slate-200"
    >
      <span className="flex items-center gap-2">
        <Moon size={16} aria-hidden="true" />
        다크모드
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition-colors ${
          isDark ? "bg-blue-500" : "bg-zinc-600 light:bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            isDark ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
