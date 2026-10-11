// 임시 호환용: Gemini 예산·연결 안내는 작업 9에서 함께 바꿔요.
// 그 전까지 기존 도움말의 표시와 문구를 그대로 유지해요.
import React, { useId } from "react";

export function LegacyHelp({ children }) {
  const id = useId();
  return (
    <span className="group relative ml-1 inline-flex text-xs text-theme-text-secondary">
      <button
        type="button"
        aria-label="자세한 설명"
        aria-describedby={id}
        className="cursor-help rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        (?)
      </button>
      <span
        id={id}
        role="tooltip"
        className="absolute right-0 top-full z-50 hidden w-64 max-w-[80vw] whitespace-normal rounded-lg border border-theme-sidebar-border bg-theme-bg-primary p-3 text-left font-normal shadow-lg group-hover:block group-focus-within:block"
      >
        {children}
      </span>
    </span>
  );
}

export function LegacyCard({
  title,
  description,
  help,
  children,
  tone = "default",
}) {
  return (
    <section
      className={`schat-admin-card ${tone === "danger" ? "schat-admin-card--danger" : ""} rounded-xl p-5 flex flex-col gap-y-4`}
    >
      {(title || description) && (
        <header className="flex flex-col gap-y-1">
          {title && (
            <h2 className="text-base font-semibold text-theme-text-primary">
              {title}
              {help && <LegacyHelp>{help}</LegacyHelp>}
            </h2>
          )}
          {description && (
            <p className="text-xs leading-5 text-theme-text-secondary">
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
