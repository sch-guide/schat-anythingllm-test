export const defaultBrand = () => ({
  logo: null,
  subtitle: "병원 실무지침 AI",
  announcement: { enabled: false, text: "", start: "", end: "" },
  welcome: { text: "오늘 어떻게 도와드릴까요?", examples: [] },
});
export function announcementActive(notice, now = Date.now()) {
  return (
    !!notice?.enabled &&
    !!notice.text &&
    (!notice.start || now >= Date.parse(notice.start)) &&
    (!notice.end || now < Date.parse(notice.end))
  );
}
export function fromKoreaInput(value) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : "";
}
export function toKoreaInput(value) {
  return value
    ? new Date(Date.parse(value) + 9 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 16)
    : "";
}
export function checkLogoFile(file) {
  if (!file || file.size > 1024 * 1024)
    throw Error("로고는 1MB 이하 파일을 선택해 주세요.");
  if (
    !/\.(png|svg)$/i.test(file.name) ||
    !["image/png", "image/svg+xml", ""].includes(file.type)
  )
    throw Error("PNG 또는 SVG 로고를 선택해 주세요.");
}
export function readLogoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error("로고 파일을 읽지 못했습니다."));
    reader.onload = () => {
      try {
        const value = String(reader.result);
        if (/\.svg$/i.test(file.name)) {
          const text = new TextDecoder().decode(
            Uint8Array.from(atob(value.split(",")[1]), (c) => c.charCodeAt(0))
          );
          const doc = new DOMParser().parseFromString(text, "image/svg+xml");
          const tags = new Set(
            "svg g path rect circle ellipse line polyline polygon title desc defs linearGradient radialGradient stop clipPath".split(
              " "
            )
          );
          const attrs = new Set(
            "xmlns viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity transform id offset stop-color stop-opacity gradientUnits gradientTransform clip-path preserveAspectRatio".split(
              " "
            )
          );
          if (
            /<!DOCTYPE|<!ENTITY|<\?|&/i.test(text) ||
            doc.documentElement.localName !== "svg"
          )
            throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
          for (const el of doc.querySelectorAll("*")) {
            if (!tags.has(el.tagName))
              throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
            for (const a of el.attributes)
              if (
                !attrs.has(a.name) ||
                (a.name === "xmlns" &&
                  a.value !== "http://www.w3.org/2000/svg") ||
                (a.name !== "xmlns" &&
                  /(?:url\s*\(\s*(?!#[\w-]+\s*\))|(?:javascript|data|https?|file):|[<>\\])/i.test(
                    a.value
                  ))
              )
                throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
          }
          resolve(`data:image/svg+xml;base64,${value.split(",")[1]}`);
        } else {
          const bytes = atob(value.split(",")[1]);
          if (!bytes.startsWith("\x89PNG\r\n\x1a\n"))
            throw Error("PNG 파일을 확인해 주세요.");
          resolve(`data:image/png;base64,${value.split(",")[1]}`);
        }
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsDataURL(file);
  });
}
