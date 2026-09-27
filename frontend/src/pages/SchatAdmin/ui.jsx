// Small building blocks shared by the SCHAT admin sections. Wording on these
// screens is written for non-developer hospital administrators.

export const inputClass =
  "schat-admin-input w-full rounded-lg px-3 py-2 text-sm outline-none bg-theme-settings-input-bg text-theme-text-primary placeholder:text-theme-settings-input-placeholder border border-transparent focus:border-sky-500";

export function Card({ title, description, children, tone = "default" }) {
  return (
    <section
      className={`schat-admin-card ${tone === "danger" ? "schat-admin-card--danger" : ""} rounded-xl p-5 flex flex-col gap-y-4`}
    >
      {(title || description) && (
        <header className="flex flex-col gap-y-1">
          {title && (
            <h2 className="text-base font-semibold text-theme-text-primary">
              {title}
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

export function Field({ label, help, htmlFor, children }) {
  return (
    <div className="flex flex-col gap-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-theme-text-primary"
      >
        {label}
      </label>
      {children}
      {help && (
        <p className="text-xs leading-5 text-theme-text-secondary">{help}</p>
      )}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  ...props
}) {
  const variants = {
    primary: "schat-admin-button--primary",
    secondary: "schat-admin-button--secondary",
    danger: "schat-admin-button--danger",
  };
  return (
    <button
      type={type}
      className={`schat-admin-button ${variants[variant]} inline-flex items-center justify-center gap-x-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children }) {
  return (
    <span
      className={`schat-admin-badge schat-admin-badge--${tone} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0`}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = "info", children }) {
  return (
    <div
      className={`schat-admin-notice schat-admin-notice--${tone} rounded-lg px-3.5 py-2.5 text-xs leading-5`}
    >
      {children}
    </div>
  );
}

export function InfoRow({ label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-theme-sidebar-border last:border-b-0">
      <span className="text-sm text-theme-text-secondary">{label}</span>
      <span className="text-sm font-medium text-theme-text-primary text-right">
        {children}
      </span>
    </div>
  );
}

export function Loading() {
  return (
    <p className="text-sm text-theme-text-secondary animate-pulse">
      불러오는 중...
    </p>
  );
}

const KNOWN_ERRORS = [
  [
    /username must start with a lowercase letter/i,
    "아이디는 영문 소문자로 시작하고 영문 소문자, 숫자, 점(.), 밑줄(_), 하이픈(-)만 사용할 수 있습니다.",
  ],
  [/username must be at least/i, "아이디는 2자 이상이어야 합니다."],
  [/username cannot be longer/i, "아이디는 64자 이하여야 합니다."],
  [/password/i, "비밀번호 조건을 확인해 주세요. (8자 이상)"],
  [/unique constraint|already exists|taken/i, "이미 사용 중인 아이디입니다."],
  [/admin/i, "마지막 관리자 계정은 역할을 바꾸거나 삭제할 수 없습니다."],
];

// Server messages are English; show a Korean explanation instead.
export function koreanError(error, fallback = "요청을 처리하지 못했습니다.") {
  if (!error) return fallback;
  const text = String(error);
  const match = KNOWN_ERRORS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : fallback;
}
