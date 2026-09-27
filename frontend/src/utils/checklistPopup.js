export const CHECKLIST_POPUP_SIZE = { width: 420, height: 640 };

export function checklistPopupPath(workspaceSlug, checklistId) {
  return `/workspace/${encodeURIComponent(workspaceSlug)}/checklist/${encodeURIComponent(checklistId)}`;
}

/**
 * Opens the checklist as its own small browser window. A popup is a separate
 * top-level OS window, so it can be moved, resized, minimized and closed
 * independently and stays visible when the main SCHAT window is minimized.
 * Reusing the window name focuses an already open checklist window.
 */
export function openChecklistPopup(workspaceSlug, checklistId) {
  if (!workspaceSlug || !checklistId || typeof window === "undefined")
    return null;
  const { width, height } = CHECKLIST_POPUP_SIZE;
  const left = Math.max(
    0,
    (window.screenX || 0) + (window.outerWidth || 0) - width - 40
  );
  const top = Math.max(0, (window.screenY || 0) + 80);
  const popup = window.open(
    checklistPopupPath(workspaceSlug, checklistId),
    `schat-checklist-${checklistId}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
  );
  popup?.focus?.();
  return popup;
}
