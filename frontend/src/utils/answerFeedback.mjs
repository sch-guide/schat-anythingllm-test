// A synchronous lock closes the gap before React rerenders disabled buttons.
export function createFeedbackController({
  initial = null,
  save,
  onChange = () => {},
}) {
  const controller = {
    selected: initial,
    pending: false,
    async submit(feedback, details = {}) {
      if (controller.pending) return false;
      controller.pending = true;
      onChange({ selected: controller.selected, pending: true });
      try {
        const success = await save(feedback, details);
        if (success === true) controller.selected = feedback;
        return success === true;
      } catch {
        return false;
      } finally {
        controller.pending = false;
        onChange({ selected: controller.selected, pending: false });
      }
    },
  };
  return controller;
}
