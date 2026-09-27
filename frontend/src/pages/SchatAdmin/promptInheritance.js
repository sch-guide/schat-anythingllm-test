// A workspace with no prompt of its own (null) inherits the admin Default
// System Prompt ("SCHAT 기본 답변 규칙"). An empty string is a deliberate
// blank prompt, not inheritance.
export function promptInheritance(workspace, defaultPrompt = "") {
  const own = workspace?.openAiPrompt;
  const inherits = own === null || own === undefined;
  return {
    inherits,
    sameAsDefault:
      !inherits && String(own).trim() === String(defaultPrompt || "").trim(),
  };
}
