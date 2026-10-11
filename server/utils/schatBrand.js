const MAX_LOGO_BYTES = 1024 * 1024;
const defaults = () => ({
  logo: null,
  subtitle: "병원 실무지침 AI",
  announcement: { enabled: false, text: "", start: "", end: "" },
  welcome: { text: "오늘 어떻게 도와드릴까요?", examples: [] },
});
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
function validateLogo(value) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 100
  )
    throw Error("로고는 1MB 이하 PNG 또는 SVG 파일이어야 합니다.");
  const match = value.match(
    /^data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/
  );
  if (!match) throw Error("로고는 PNG 또는 SVG 파일이어야 합니다.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES)
    throw Error("로고는 1MB 이하여야 합니다.");
  if (bytes.toString("base64") !== match[2])
    throw Error("로고 파일이 올바르지 않습니다.");
  if (match[1] === "png") {
    if (
      bytes.length < 45 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.subarray(12, 16).toString() !== "IHDR" ||
      !bytes.readUInt32BE(16) ||
      !bytes.readUInt32BE(20)
    )
      throw Error("PNG 파일을 확인해 주세요.");
    let offset = 8,
      data = false,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        type = bytes.subarray(offset + 4, offset + 8).toString();
      if (offset + 12 + length > bytes.length)
        throw Error("PNG 파일을 확인해 주세요.");
      if (type === "IDAT") data = true;
      offset += 12 + length;
      if (type === "IEND") {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!data || !ended) throw Error("PNG 파일을 확인해 주세요.");
  } else {
    const text = bytes.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY|<\?|[\u0000-\u0008]/i.test(text))
      throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
    validateSvg(text);
  }
  return value;
}
// Accept a deliberately small, balanced SVG drawing subset. No entities,
// namespaces, CSS, active elements or URLs other than local paint references.
function validateSvg(text) {
  const stack = [];
  let root = false,
    count = 0;
  for (const token of text.match(/<[^<>]*>|[^<]+|</g) || []) {
    if (!token.startsWith("<")) {
      if (/[>&]/.test(token) || (!stack.length && token.trim()))
        throw Error("SVG 파일을 확인해 주세요.");
      continue;
    }
    if (token.startsWith("<!--") && /^<!--[\s\S]*-->$/.test(token)) continue;
    const close = token.match(/^<\/([A-Za-z]+)\s*>$/);
    if (close) {
      if (stack.pop() !== close[1]) throw Error("SVG 파일을 확인해 주세요.");
      continue;
    }
    const open = token.match(/^<([A-Za-z]+)(\s[\s\S]*?)?\s*(\/?)>$/);
    if (
      !open ||
      !tags.has(open[1]) ||
      ++count > 10000 ||
      (!stack.length && (root || open[1] !== "svg"))
    )
      throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
    if (!stack.length) root = true;
    let rest = open[2] || "";
    const used = new Set();
    while (rest.trim()) {
      const attr = rest.match(/^\s+([A-Za-z][\w-]*)\s*=\s*(["'])([^"'<>]*)\2/);
      if (
        !attr ||
        !attrs.has(attr[1]) ||
        used.has(attr[1]) ||
        /[&\\]/.test(attr[3]) ||
        (attr[1] === "xmlns" && attr[3] !== "http://www.w3.org/2000/svg") ||
        (attr[1] !== "xmlns" &&
          /(?:url\s*\(\s*(?!#[\w-]+\s*\))|(?:javascript|data|https?|file):)/i.test(
            attr[3]
          ))
      )
        throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
      used.add(attr[1]);
      rest = rest.slice(attr[0].length);
    }
    if (!open[3]) stack.push(open[1]);
  }
  if (!root || stack.length) throw Error("SVG 파일을 확인해 주세요.");
}
function plainText(value, max, allowEmpty = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ||
    (!allowEmpty && !value.trim())
  )
    throw Error("문구를 길이 제한 안에서 일반 글자로 입력해 주세요.");
  return value.trim();
}
function validateSection(section, value) {
  if (section === "logo") return validateLogo(value);
  if (section === "subtitle") return plainText(value, 80, false);
  if (section === "welcome") {
    if (!value || !Array.isArray(value.examples) || value.examples.length > 5)
      throw Error("예시 질문은 5개 이하로 입력해 주세요.");
    return {
      text: plainText(value.text, 160, false),
      examples: value.examples.map((v) => plainText(v, 200, false)),
    };
  }
  if (section === "announcement") {
    if (!value || typeof value.enabled !== "boolean")
      throw Error("공지 설정을 확인해 주세요.");
    const next = {
      enabled: value.enabled,
      text: plainText(value.text, 200),
      start: "",
      end: "",
    };
    if (next.enabled && !next.text) throw Error("공지 내용을 입력해 주세요.");
    for (const key of ["start", "end"]) {
      if (value[key] === "") continue;
      if (
        typeof value[key] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          value[key]
        ) ||
        !Number.isFinite(Date.parse(value[key]))
      )
        throw Error("공지 일시를 확인해 주세요.");
      next[key] = new Date(value[key]).toISOString();
    }
    if (
      next.start &&
      next.end &&
      Date.parse(next.start) >= Date.parse(next.end)
    )
      throw Error("종료 일시는 시작 일시보다 뒤여야 합니다.");
    return next;
  }
  throw Error("변경할 브랜드 항목을 확인해 주세요.");
}
function publicBrand(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    input = {};
  }
  const brand = defaults();
  for (const key of Object.keys(brand)) {
    if (!Object.prototype.hasOwnProperty.call(input || {}, key)) continue;
    try {
      brand[key] = validateSection(key, input[key]);
    } catch {
      /* Invalid stored values use safe defaults. */
    }
  }
  return brand;
}
function announcementActive(notice, now = Date.now()) {
  return (
    !!notice?.enabled &&
    !!notice.text &&
    (!notice.start || now >= Date.parse(notice.start)) &&
    (!notice.end || now < Date.parse(notice.end))
  );
}
module.exports = {
  defaults,
  validateLogo,
  validateSvg,
  validateSection,
  publicBrand,
  announcementActive,
};
