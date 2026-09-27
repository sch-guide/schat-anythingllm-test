export const PROCEDURE_LAYOUT_CLASSES =
  "w-full max-w-[780px] leading-[1.7]";

function normalizedSourceIndexes(sourceIndexes, sources) {
  if (!Array.isArray(sourceIndexes)) return [];

  return [...new Set(sourceIndexes)]
    .filter(
      (index) =>
        Number.isInteger(index) && index > 0 && index <= sources.length
    )
    .map((index) => {
      const source = sources[index - 1];
      return {
        index,
        title: source?.title || `출처 ${index}`,
        source,
      };
    });
}

export function buildProcedurePresentationModel(presentation, sources = []) {
  if (
    presentation?.kind !== "procedure" ||
    typeof presentation.summary !== "string" ||
    !presentation.summary.trim() ||
    !Array.isArray(presentation.sections) ||
    presentation.sections.length === 0
  ) {
    return null;
  }

  const sections = presentation.sections.map((section) => {
    if (
      typeof section?.title !== "string" ||
      !section.title.trim() ||
      !Array.isArray(section.items) ||
      section.items.length === 0
    ) {
      return null;
    }

    const items = section.items.map((item) => {
      if (typeof item?.text !== "string" || !item.text.trim()) return null;

      return {
        text: item.text.trim(),
        badges: normalizedSourceIndexes(item.sourceIndexes, sources),
      };
    });

    if (items.some((item) => item === null)) return null;
    return { title: section.title.trim(), items };
  });

  if (sections.some((section) => section === null)) return null;
  return { summary: presentation.summary.trim(), sections };
}
