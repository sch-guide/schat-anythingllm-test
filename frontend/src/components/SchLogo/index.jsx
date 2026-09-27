import schLogo from "@/media/logo/sch-logo.png";

// Native size of the provided SCH mark. There is no larger original, so CSS
// only ever shrinks it (max 34px tall keeps 2x screens at or below 188px).
const NATIVE = { width: 188, height: 68 };

// Single shared SCH brand mark (blue box, white "SCH") used on the login
// screen. The browser tab icon is a square crop of the same image.
export default function SchLogo({ className = "", alt = "SCH" }) {
  return (
    <img
      src={schLogo}
      alt={alt}
      width={NATIVE.width}
      height={NATIVE.height}
      decoding="async"
      className={`sch-logo ${className}`.trim()}
    />
  );
}
