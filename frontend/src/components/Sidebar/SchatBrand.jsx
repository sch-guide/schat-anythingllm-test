export default function SchatBrand({ compact = false }) {
  return (
    <div
      className={`flex items-center ${compact ? "gap-2" : "gap-2.5"}`}
      aria-label="SCHAT 홈"
    >
      <span
        className={`${
          compact ? "text-lg" : "text-base"
        } font-semibold tracking-[0.04em] text-white light:text-slate-900`}
      >
        SCHAT
      </span>
    </div>
  );
}
