function leafName(value = "") {
  return (
    String(value)
      .trim()
      .replace(/^file:\/\//iu, "")
      .split(/[\\/]/u)
      .filter(Boolean)
      .at(-1) || ""
  );
}

export function employeeDocumentName(source = {}) {
  const named = source.documentName || source.document_name;
  if (typeof named === "string" && named.trim()) return leafName(named);
  const title = leafName(source.title || "");
  const pdf = title.match(/^(.+?\.pdf)(?:\s*(?:·|,)\s*.*)?$/iu);
  if (pdf) return pdf[1];
  return title
    .replace(/\s*(?:·|,)\s*p\.?\s*\d+.*$/iu, "")
    .replace(/\s*(?:·|,)\s*\d+\s*쪽.*$/u, "");
}

// Removes only page labels attached to a PDF source. Clinical values such as
// "15분" or ordinary uses of "13쪽" elsewhere in the answer remain intact.
export function hideEmployeeSourcePages(value = "") {
  return String(value)
    .replace(/(\.pdf)\s*(?:·|,)\s*p\.?\s*\d+/giu, "$1")
    .replace(/(\.pdf)\s*(?:·|,)\s*\d+\s*쪽/giu, "$1");
}
