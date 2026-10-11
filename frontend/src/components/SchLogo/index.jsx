import schLogo from "@/media/logo/sch-logo.png";
import useSchatBrand from "@/hooks/useSchatBrand";

// Native size of the provided SCH mark. There is no larger original, so CSS
// only ever shrinks it (max 34px tall keeps 2x screens at or below 188px).
const NATIVE = { width: 188, height: 68 };

// Single shared SCH brand mark (blue box, white "SCH") used on the login
// screen. The browser tab icon is a square crop of the same image.
export default function SchLogo({ className = "", alt = "SCH", src }) {
  const { brand } = useSchatBrand();
  const customLogo = src === undefined ? brand.logo : src;
  return (
    <img
      src={customLogo || schLogo}
      alt={alt}
      width={customLogo ? undefined : NATIVE.width}
      height={customLogo ? undefined : NATIVE.height}
      style={
        customLogo
          ? { maxWidth: "180px", maxHeight: "34px", objectFit: "contain" }
          : undefined
      }
      decoding="async"
      className={
        customLogo
          ? `object-contain ${className}`.trim()
          : `sch-logo ${className}`.trim()
      }
    />
  );
}
