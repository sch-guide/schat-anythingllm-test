const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function defaultStorageRoot() {
  if (process.env.SCHAT_DOCUMENT_CHECKLISTS_DIR)
    return path.resolve(process.env.SCHAT_DOCUMENT_CHECKLISTS_DIR);
  if (process.env.NODE_ENV === "production" && process.env.STORAGE_DIR)
    return path.resolve(process.env.STORAGE_DIR, "document-checklists");
  return path.resolve(__dirname, "../../storage/document-checklists");
}

function storageKey(documentId, page) {
  return crypto
    .createHash("sha256")
    .update(`${String(documentId)}\u0000${Number(page)}`)
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
        return {
          id: itemId(sectionIndex, itemIndex, item.id),
          type: item.type,
          label: cleanString(item.label, "item label", 200),
          details: item.details
            .map((detail) => cleanString(detail, "item detail", 4000))
            .slice(0, 100),
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
    return path.join(
      root,
      `${storageKey(checklist.documentId, checklist.source?.page || checklist.page)}.json`
    );
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

  function saveAutoChecklist(checklist) {
    if (!checklist?.documentId || !checklist?.id)
      throw new Error("Invalid automatic checklist.");
    const definition = validateEditableDefinition(checklist);
    const filePath = filePathFor(checklist);
    const existing = readFile(filePath);
    if (existing?.editedByAdmin) return { created: false, checklist: existing };
    const sameContent =
      existing &&
      existing.status ===
        (checklist.status === "needs_review" ? "needs_review" : "active") &&
      JSON.stringify([existing.title, existing.aliases, existing.sections]) ===
        JSON.stringify([
          definition.title,
          definition.aliases,
          definition.sections,
        ]);
    if (sameContent) return { created: false, checklist: existing };

    // Automatic results that failed source verification stay hidden from
    // employees until an administrator looks at them.
    const needsReview = checklist.status === "needs_review";
    const value = {
      ...checklist,
      ...definition,
      status: needsReview ? "needs_review" : "active",
      active: !needsReview,
      autoGenerated: true,
      editedByAdmin: false,
      createdAt:
        existing?.createdAt || checklist.createdAt || new Date().toISOString(),
      updatedAt: checklist.updatedAt || new Date().toISOString(),
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
        return includeReview && checklist.status === "needs_review";
      })
      .sort(
        (a, b) =>
          String(a.documentId).localeCompare(String(b.documentId)) ||
          Number(a.source?.page || a.page || 0) -
            Number(b.source?.page || b.page || 0)
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

  return {
    storageRoot: root,
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
  validateEditableDefinition,
};
