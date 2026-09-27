import { decode as HTMLDecode } from "he";

function omitMetadataHeader(text = "") {
  if (!text.includes("<document_metadata>")) return text;
  return text.split("</document_metadata>")[1]?.trim() || "";
}

export default function SourceExcerpt({ text = "" }) {
  const excerpt = omitMetadataHeader(text).trim();
  if (!excerpt) return null;

  return (
    <section className="flex min-h-0 w-full flex-col gap-y-2">
      <p className="text-xs font-medium text-zinc-400 light:text-slate-500">
        근거 원문
      </p>
      <div className="max-h-[50vh] overflow-y-auto border-y border-zinc-700 py-3 pr-1 light:border-slate-200">
        <p className="whitespace-pre-line break-words text-sm leading-[1.6] text-zinc-100 light:text-slate-900">
          {HTMLDecode(excerpt)}
        </p>
      </div>
    </section>
  );
}
