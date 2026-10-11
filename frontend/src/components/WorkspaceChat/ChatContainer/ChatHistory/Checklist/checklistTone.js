// Card colours of the checklist tree. "default" is the administrator screen
// as before; "blue" is the employee panel / separate window (light blue
// border, very light blue header, vivid blue titles and checkboxes).
export const CHECKLIST_TONES = {
  default: {
    card: "border-zinc-700 bg-zinc-900 light:border-slate-200 light:bg-white",
    header: "text-zinc-50 light:text-slate-900",
    divider: "border-zinc-700 light:border-slate-200",
    checkbox: "accent-sky-600",
  },
  blue: {
    card: "shrink-0 overflow-hidden border-blue-400/40 bg-zinc-900 light:border-blue-200 light:bg-white",
    header: "bg-blue-500/10 text-blue-300 light:bg-blue-50 light:text-blue-700",
    divider: "border-blue-400/30 light:border-blue-100",
    checkbox: "schat-blue-checkbox",
  },
};

export function checklistTone(name) {
  return CHECKLIST_TONES[name] || CHECKLIST_TONES.default;
}
