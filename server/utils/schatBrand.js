const MAX_LOGO_BYTES = 1024 * 1024;
// 직원 화면 공지 띠의 제목. 비워 두면 화면에는 "공지사항"으로 보인다.
const DEFAULT_NOTICE_TITLE = "공지사항";
const NOTICE_TITLE_MAX = 8;
// 로그인 화면·메뉴의 소속 표시. 비워 두면 두 곳 모두 숨긴다.
const DEFAULT_AFFILIATION = "간호교육파트";
const AFFILIATION_MAX = 12;
const { inflateSync } = require("node:zlib");
const defaults = () => ({
  logo: null,
  subtitle: "병원 실무지침 AI",
  affiliation: DEFAULT_AFFILIATION,
  announcement: {
    enabled: false,
    title: DEFAULT_NOTICE_TITLE,
    text: "",
    start: "",
    end: "",
  },
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
    try {
      validatePng(bytes);
    } catch {
      throw Error(
        "PNG 파일이 손상되었거나 지원 크기를 넘었습니다. 다른 PNG를 선택해 주세요."
      );
    }
  } else {
    const text = bytes.toString("utf8");
    if (/<!DOCTYPE|<!ENTITY|<\?|[\u0000-\u0008]/i.test(text))
      throw Error("SVG 실행 코드와 외부 참조는 사용할 수 없습니다.");
    validateSvg(text);
  }
  return value;
}
function pngCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function validatePng(bytes) {
  const fail = () => {
    throw Error("Invalid PNG");
  };
  if (
    bytes.length < 45 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    fail();
  let offset = 8,
    header = null,
    palette = 0,
    ended = false,
    afterData = false;
  const data = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      type = bytes.subarray(offset + 4, offset + 8).toString();
    if (
      !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) ||
      length > bytes.length - offset - 12 ||
      pngCrc(bytes.subarray(offset + 4, offset + 8 + length)) !==
        bytes.readUInt32BE(offset + 8 + length)
    )
      fail();
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (!header && type !== "IHDR") fail();
    if (type === "IHDR") {
      if (header || length !== 13) fail();
      header = {
        width: chunk.readUInt32BE(0),
        height: chunk.readUInt32BE(4),
        depth: chunk[8],
        color: chunk[9],
        interlace: chunk[12],
      };
      const depths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[header.color]?.includes(header.depth) ||
        chunk[10] !== 0 ||
        chunk[11] !== 0 ||
        ![0, 1].includes(header.interlace) ||
        !header.width ||
        !header.height ||
        header.width > 8192 ||
        header.height > 8192 ||
        header.width * header.height > 16777216
      )
        fail();
    } else if (type === "PLTE") {
      if (
        palette ||
        data.length ||
        !length ||
        length > 768 ||
        length % 3 ||
        [0, 4].includes(header.color)
      )
        fail();
      palette = length / 3;
      if (header.color === 3 && palette > 2 ** header.depth) fail();
    } else if (type === "IDAT") {
      if (afterData || (header.color === 3 && !palette)) fail();
      data.push(chunk);
    } else if (type === "IEND") {
      if (length || !data.length || offset + 12 !== bytes.length) fail();
      ended = true;
      break;
    } else {
      // Unknown critical chunks cannot be interpreted as a valid PNG image.
      if (type[0] === type[0].toUpperCase()) fail();
      if (data.length) afterData = true;
    }
    offset += length + 12;
  }
  if (!ended) fail();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color],
    pixelBits = channels * header.depth;
  const passes = header.interlace
    ? [
        [0, 0, 8, 8],
        [4, 0, 8, 8],
        [0, 4, 4, 8],
        [2, 0, 4, 4],
        [0, 2, 2, 4],
        [1, 0, 2, 2],
        [0, 1, 1, 2],
      ]
    : [[0, 0, 1, 1]];
  const rows = passes
    .map(([x, y, dx, dy]) => ({
      width: Math.max(0, Math.ceil((header.width - x) / dx)),
      height: Math.max(0, Math.ceil((header.height - y) / dy)),
    }))
    .filter((pass) => pass.width && pass.height);
  const expected = rows.reduce(
    (sum, pass) =>
      sum + (Math.ceil((pass.width * pixelBits) / 8) + 1) * pass.height,
    0
  );
  if (expected > 64 * 1024 * 1024) fail();
  const raw = inflateSync(Buffer.concat(data), {
    maxOutputLength: expected + 1,
    info: true,
  });
  // Reject trailing compressed bytes and decoded rows of the wrong length.
  if (
    raw.buffer.length !== expected ||
    raw.engine.bytesWritten !==
      data.reduce((sum, chunk) => sum + chunk.length, 0)
  )
    fail();
  let position = 0;
  const bpp = Math.max(1, Math.ceil(pixelBits / 8));
  for (const pass of rows) {
    const rowLength = Math.ceil((pass.width * pixelBits) / 8);
    let previous = Buffer.alloc(rowLength);
    for (let y = 0; y < pass.height; y++) {
      const filter = raw.buffer[position++];
      if (filter > 4) fail();
      const row = Buffer.from(
        raw.buffer.subarray(position, position + rowLength)
      );
      position += rowLength;
      for (let x = 0; x < rowLength; x++) {
        const a = x >= bpp ? row[x - bpp] : 0,
          b = previous[x],
          c = x >= bpp ? previous[x - bpp] : 0;
        let predictor = 0;
        if (filter === 1) predictor = a;
        if (filter === 2) predictor = b;
        if (filter === 3) predictor = Math.floor((a + b) / 2);
        if (filter === 4) {
          const p = a + b - c,
            pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        row[x] = (row[x] + predictor) & 255;
      }
      if (header.color === 3)
        for (let x = 0; x < pass.width; x++) {
          const bit = x * header.depth,
            sample =
              (row[bit >> 3] >> (8 - header.depth - (bit % 8))) &
              ((1 << header.depth) - 1);
          if (sample >= palette) fail();
        }
      previous = row;
    }
  }
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
  if (section === "affiliation") return plainText(value, AFFILIATION_MAX);
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
      // Notices saved before the title existed keep the default title.
      title:
        value.title === undefined
          ? DEFAULT_NOTICE_TITLE
          : plainText(value.title, NOTICE_TITLE_MAX),
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
  DEFAULT_NOTICE_TITLE,
  NOTICE_TITLE_MAX,
  DEFAULT_AFFILIATION,
  AFFILIATION_MAX,
  defaults,
  validateLogo,
  validateSvg,
  validateSection,
  publicBrand,
  announcementActive,
};
