// 지침서 퀴즈 mark: an open book with a check, drawn as a simple outline in
// the same weight as the other SCHAT sidebar icons. Uses currentColor.
export default function QuizIcon({ size = 20, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`schat-quiz-icon shrink-0 ${className}`.trim()}
    >
      <path d="M12 6.2c-1.9-1.3-4.3-1.9-7.2-1.8a.8.8 0 0 0-.8.8v11.9c0 .5.4.8.9.8 2.7-.1 5 .5 7.1 1.8 2.1-1.3 4.4-1.9 7.1-1.8.5 0 .9-.3.9-.8V5.2a.8.8 0 0 0-.8-.8c-2.9-.1-5.3.5-7.2 1.8Z" />
      <path d="M12 6.2v13.3" />
      <path d="m14.4 11.4 1.5 1.5 3-3.1" />
    </svg>
  );
}
