// 이용 가이드 mark: a white speech bubble with a blue outline and a "?".
// Drawn inline so the fill stays white and the outline stays SCHAT blue in
// both light and dark mode (see .schat-guide-icon in schat-brand.css).
export default function GuideIcon({ size = 20, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`schat-guide-icon shrink-0 ${className}`.trim()}
    >
      <path
        className="schat-guide-icon__bubble"
        d="M12 3.2c4.9 0 8.8 3.4 8.8 7.6S16.9 18.4 12 18.4c-.9 0-1.8-.1-2.6-.3L5 20.6l1.1-3.9C4.3 15.3 3.2 13.2 3.2 10.8 3.2 6.6 7.1 3.2 12 3.2Z"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        className="schat-guide-icon__mark"
        d="M9.9 8.7a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.6v.4"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle className="schat-guide-icon__dot" cx="12" cy="15.1" r="0.95" />
    </svg>
  );
}
