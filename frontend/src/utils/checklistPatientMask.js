export function maskChecklistPatient(value) {
  const text = String(value ?? "").normalize("NFC");
  // A room prefix belongs to the room, not the following Korean name.
  return text
    .split(/(\d+호)/u)
    .map((part) => {
      if (/^\d+호$/u.test(part)) return part;
      return part.replace(/[가-힣○]+/gu, (word) => {
        if (word.length < 2) return word;
        return word.length === 2
          ? `${word[0]}○`
          : `${word[0]}${"○".repeat(word.length - 2)}${word.at(-1)}`;
      });
    })
    .join("");
}
