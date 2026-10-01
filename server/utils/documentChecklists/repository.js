const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { contentFingerprint } = require("./versionMatch");

function defaultStorageRoot() {
  if (process.env.SCHAT_DOCUMENT_CHECKLISTS_DIR)
    return path.resolve(process.env.SCHAT_DOCUMENT_CHECKLISTS_DIR);
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_DIR)
    return path.resolve(process.env.STORAGE_DIR, "document-checklists");
  return path.resolve(__dirname, "../../storage/document-checklists");
}

// needs_review: waiting for an administrator (hidden from employees)
// active:       shown to employees
// hidden:       deliberately hidden by an administrator
const CHECKLIST_STATUSES = Object.freeze(["needs_review", "active", "hidden"]);
// 자료 분류 values an administrator can choose (presenter.js uses the same).
const ADMIN_KINDS = Object.freeze(["procedure", "surgery", "other"]);

function storageKey(documentId, page, checklistId = "") {
  return crypto
    .createHash("sha256")
    .update(
      `${String(documentId)}\u0000${Number(page)}${
        checklistId ? `\u0000${String(checklistId)}` : ""
      }`
    )
    .digest("hex");
}

function cleanString(value, name, maxLength = 4000) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid checklist ${name}.`);
  const cleaned = value.trim();
  if (cleaned.length > maxLength)
    throw new Error(`Checklist ${name} is too long.`);
  return cleaned;
}

function itemId(sectionIndex, itemIndex, current) {
  return (
    String(current || "").trim() ||
    crypto
      .createHash("sha256")
      .update(
        `section:${sectionIndex}:item:${itemIndex}:${crypto.randomUUID()}`
      )
      .digest("hex")
      .slice(0, 24)
  );
}

function validateEditableDefinition(input = {}) {
  const title = cleanString(input.title, "title", 200);
  if (!Array.isArray(input.aliases) || input.aliases.length === 0)
    throw new Error("Invalid checklist aliases.");
  const aliases = input.aliases.map((alias) =>
    cleanString(alias, "alias", 100)
  );
  if (!Array.isArray(input.sections) || input.sections.length === 0)
    throw new Error("Invalid checklist sections.");

  const sections = input.sections.map((section, sectionIndex) => {
    if (!Array.isArray(section.items))
      throw new Error("Invalid checklist items.");
    return {
      id:
        String(section.id || "").trim() ||
        crypto
          .createHash("sha256")
          .update(`section:${sectionIndex}:${crypto.randomUUID()}`)
          .digest("hex")
          .slice(0, 24),
      title: cleanString(section.title, "section title", 100),
      items: section.items.map((item, itemIndex) => {
        if (!new Set(["informational", "checkable"]).has(item.type))
          throw new Error("Invalid checklist item type.");
        if (!Array.isArray(item.details))
          throw new Error("Invalid checklist item details.");
        const details = item.details
          .map((detail) => cleanString(detail, "item detail", 4000))
          .slice(0, 100);
        // Optional administrator setting: one boolean per detail line saying
        // whether that line gets its own checkbox. Without it the employee
        // screen keeps the automatic rule (existing checklists unchanged).
        let detailCheckable;
        if (
          item.detailCheckable !== undefined &&
          item.detailCheckable !== null
        ) {
          if (
            !Array.isArray(item.detailCheckable) ||
            item.detailCheckable.length !== item.details.length ||
            item.detailCheckable.some((value) => typeof value !== "boolean")
          )
            throw new Error("Invalid checklist line checkbox settings.");
          detailCheckable = item.detailCheckable.slice(0, 100);
        }
        return {
          id: itemId(sectionIndex, itemIndex, item.id),
          type: item.type,
          label: cleanString(item.label, "item label", 200),
          details,
          ...(detailCheckable ? { detailCheckable } : {}),
        };
      }),
    };
  });

  return { title, aliases: [...new Set(aliases)], sections };
}

function createChecklistRepository({
  storageRoot = defaultStorageRoot(),
} = {}) {
  const root = path.resolve(storageRoot);

  function ensureRoot() {
    fs.mkdirSync(root, { recursive: true });
  }

  function readFile(filePath) {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  function listAll() {
    ensureRoot();
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readFile(path.join(root, entry.name)))
      .filter(Boolean);
  }

  function filePathFor(checklist) {
    const page = checklist.source?.page || checklist.page;
    const exact = path.join(
      root,
      `${storageKey(checklist.documentId, page, checklist.id)}.json`
    );
    if (fs.existsSync(exact)) return exact;
    // Files created before multi-checklist pages used document+page only.
    // Keep updating those files in place so administrator decisions survive.
    const legacy = path.join(
      root,
      `${storageKey(checklist.documentId, page)}.json`
    );
    const legacyValue = readFile(legacy);
    if (legacyValue?.id === checklist.id) return legacy;
    return exact;
  }

  function writeAtomic(filePath, value) {
    ensureRoot();
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
  }

  // `versionMatch` (from versionMatch.matchPreviousVersion) is only used for a
  // page that has no checklist yet, i.e. a newly uploaded edition.
  function saveAutoChecklist(checklist, { versionMatch = null } = {}) {
    if (!checklist?.documentId || !checklist?.id)
      throw new Error("Invalid automatic checklist.");
    const definition = validateEditableDefinition(checklist);
    const filePath = filePathFor(checklist);
    const existing = readFile(filePath);
    const sourceFingerprint = contentFingerprint(definition);
    // An administrator's edit or status decision is never overwritten by a
    // later automatic extraction of the same page.
    if (existing?.editedByAdmin || existing?.statusSetByAdmin)
      return { created: false, checklist: existing };
    // Re-running extraction on the same page with the same content keeps the
    // checklist exactly as it is (an already public checklist stays public).
    const sameContent =
      existing &&
      JSON.stringify([existing.title, existing.aliases, existing.sections]) ===
        JSON.stringify([
          definition.title,
          definition.aliases,
          definition.sections,
        ]);
    if (sameContent) return { created: false, checklist: existing };

    const autoVerified = checklist.status !== "needs_review";
    const now = new Date().toISOString();
    const version =
      !existing && versionMatch?.result
        ? {
            result: versionMatch.result,
            previousId: versionMatch.previousId || null,
            previousDocumentId: versionMatch.previousDocumentId || null,
          }
        : null;

    // A new edition whose page reads exactly like a checklist that was
    // already public is published again. When that checklist had been edited
    // by an administrator, the same edit is carried over: it was written for
    // this identical source text.
    const previous = versionMatch?.previous;
    if (version?.result === "same" && autoVerified && previous) {
      const carried = previous.editedByAdmin
        ? validateEditableDefinition(previous)
        : definition;
      // The administrator's 자료 분류 is carried over on the same condition
      // (identical source text of the same checklist).
      const carriedKind = ADMIN_KINDS.includes(previous.adminKind)
        ? { adminKind: previous.adminKind }
        : {};
      const value = {
        ...checklist,
        ...carried,
        ...carriedKind,
        status: "active",
        active: true,
        autoVerified,
        autoGenerated: true,
        autoPublished: true,
        editedByAdmin: previous.editedByAdmin === true,
        sourceFingerprint,
        versionMatch: version,
        createdAt: checklist.createdAt || now,
        updatedAt: checklist.updatedAt || now,
      };
      writeAtomic(filePath, value);
      return { created: true, autoPublished: true, checklist: value };
    }

    // Every other new or changed automatic checklist waits for an
    // administrator ("검토 필요") and is hidden from employees until it is
    // published. autoVerified records whether the source comparison passed.
    const value = {
      ...checklist,
      ...definition,
      status: "needs_review",
      active: false,
      autoVerified,
      autoGenerated: true,
      editedByAdmin: false,
      sourceFingerprint,
      ...(version ? { versionMatch: version } : {}),
      createdAt: existing?.createdAt || checklist.createdAt || now,
      updatedAt: checklist.updatedAt || now,
    };
    writeAtomic(filePath, value);
    return { created: !existing, checklist: value };
  }

  function getById(id) {
    return listAll().find((checklist) => checklist.id === id) || null;
  }

  function findByDocumentIds(documentIds = [], { includeReview = false } = {}) {
    const allowed = new Set(documentIds.map((id) => String(id)));
    return listAll()
      .filter((checklist) => {
        if (!allowed.has(String(checklist.documentId))) return false;
        if (checklist.status === "active" && checklist.active !== false)
          return true;
        // The administrator screen lists every status; employees never
        // receive "needs_review" or "hidden" checklists.
        return includeReview;
      })
      .sort(
        (a, b) =>
          String(a.documentId).localeCompare(String(b.documentId)) ||
          Number(a.source?.page || a.page || 0) -
            Number(b.source?.page || b.page || 0) ||
          String(a.title || "").localeCompare(String(b.title || ""))
      );
  }

  function updateChecklist(id, patch) {
    const existing = getById(id);
    if (!existing) return null;
    const definition = validateEditableDefinition(patch);
    const updated = {
      ...existing,
      ...definition,
      editedByAdmin: true,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(filePathFor(existing), updated);
    return updated;
  }

  // 자료 분류 override. kind = "procedure" | "surgery" | "other", or null to
  // go back to the automatic classification. Title, aliases, sections and
  // status are untouched, and the checklist is not marked as edited.
  function setKind(id, kind) {
    if (kind !== null && !ADMIN_KINDS.includes(kind))
      throw new Error("Invalid checklist kind.");
    const existing = getById(id);
    if (!existing) return null;
    const { adminKind: _previous, ...rest } = existing;
    const updated = {
      ...rest,
      ...(kind ? { adminKind: kind } : {}),
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(filePathFor(existing), updated);
    return updated;
  }

  function setStatus(id, status) {
    if (!CHECKLIST_STATUSES.includes(status))
      throw new Error("Invalid checklist status.");
    const existing = getById(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      status,
      active: status === "active",
      statusSetByAdmin: true,
      updatedAt: new Date().toISOString(),
    };
    writeAtomic(filePathFor(existing), updated);
    return updated;
  }

  return {
    storageRoot: root,
    setStatus,
    setKind,
    saveAutoChecklist,
    updateChecklist,
    findByDocumentIds,
    getById,
    listAll,
  };
}

const ChecklistRepository = createChecklistRepository();

module.exports = {
  defaultStorageRoot,
  createChecklistRepository,
  ChecklistRepository,
  CHECKLIST_STATUSES,
  ADMIN_KINDS,
  validateEditableDefinition,
};
