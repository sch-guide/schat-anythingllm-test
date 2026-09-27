import { Fragment, useState, useEffect, useId, useCallback } from "react";
import truncate from "truncate";
import Modal, { ModalHeader, ModalBody } from "@/components/lib/Modal";
import {
  FileText,
  Info,
  ArrowSquareOut,
  GithubLogo,
  YoutubeLogo,
  LinkSimple,
  GitlabLogo,
  GitBranch,
} from "@phosphor-icons/react";
import GmailLogo from "@/pages/Admin/Agents/GMailSkillPanel/gmail.png";
import GoogleCalendarLogo from "@/pages/Admin/Agents/GoogleCalendarSkillPanel/google-calendar.png";
import OutlookLogo from "@/pages/Admin/Agents/OutlookSkillPanel/outlook.png";
import { toPercentString } from "@/utils/numbers";
import { useTranslation } from "react-i18next";
import SourceExcerpt from "../../SourcesSidebar/SourceExcerpt";
import RelatedImages from "../RelatedImages";
import PdfPageViewer from "./PdfPageViewer";
import { filterDirectCitationSources } from "@/utils/citationFilter";

const LONG_EXCERPT_LENGTH = 420;

function sourceDocumentName(source = {}) {
  const publicName = source.documentName || source.document_name;
  if (typeof publicName !== "string" || !publicName.trim()) return "";
  return publicName
    .replace(/^file:\/\//i, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
}

function sourceSummary(source = {}) {
  const documentName = sourceDocumentName(source);
  const normalizedPage =
    Number.isInteger(source.page) && source.page > 0
      ? source.page
      : typeof source.page === "string" && /^\d+$/.test(source.page.trim())
        ? Number(source.page)
        : null;
  const page = normalizedPage > 0 ? `p.${normalizedPage}` : null;
  const parts = [documentName, page].filter(Boolean);

  if (parts.length > 0) return parts.join(" · ");
  if (typeof source.title !== "string") return "";
  return source.title
    .trim()
    .replace(/^file:\/\//i, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
}

export function SourceEvidenceRow({
  source,
  index,
  workspaceSlug,
  initiallyOpen = false,
  initiallyExpanded = false,
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const [pdfUnavailable, setPdfUnavailable] = useState(!source?.pdfRef);
  const contentId = useId();
  const excerpt =
    typeof source?.excerpt === "string" ? source.excerpt.trim() : "";
  const isLong = excerpt.length > LONG_EXCERPT_LENGTH;
  const summary = sourceSummary(source);
  const paragraphs = excerpt
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const showPdf = Boolean(source?.pdfRef && workspaceSlug && !pdfUnavailable);
  const markPdfUnavailable = useCallback(() => setPdfUnavailable(true), []);

  useEffect(() => {
    setPdfUnavailable(!source?.pdfRef);
  }, [source?.pdfRef]);

  return (
    <article className="border-t border-zinc-800 py-3 first:border-t-0 light:border-slate-200">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-sm font-medium leading-[1.6] text-zinc-200 light:text-slate-800">
          <span className="text-zinc-400 light:text-slate-500">
            출처 {index + 1}
          </span>
          {summary && ` · ${summary}`}
        </p>
        {(excerpt || source?.pdfRef) && (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={contentId}
            onClick={() => setIsOpen((open) => !open)}
            className="w-fit shrink-0 text-left text-xs font-medium text-blue-300 hover:text-blue-200 light:text-blue-700 light:hover:text-blue-800"
          >
            {isOpen ? "근거 원문 접기 ▲" : "근거 원문 보기 ▼"}
          </button>
        )}
      </div>

      {isOpen && (excerpt || source?.pdfRef) && (
        <section
          id={contentId}
          className="mt-3 min-w-0 rounded-lg bg-zinc-900/60 px-4 py-4 light:bg-slate-100 sm:px-7"
        >
          {showPdf ? (
            <PdfPageViewer
              workspaceSlug={workspaceSlug}
              pdfRef={source.pdfRef}
              page={source.page}
              documentName={sourceDocumentName(source)}
              onUnavailable={markPdfUnavailable}
            />
          ) : (
            <div className="mx-auto w-full max-w-[720px]">
              <p className="mb-3 text-xs font-medium text-zinc-400 light:text-slate-500">
                근거 원문
              </p>
              <div className="relative">
                <div
                  className={`space-y-3 break-words text-sm leading-[1.7] text-zinc-100 light:text-slate-900 ${
                    isLong && !isExpanded
                      ? "max-h-[9.5rem] overflow-hidden"
                      : "max-h-[50vh] overflow-y-auto pr-1"
                  }`}
                >
                  {paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex} className="whitespace-pre-line">
                      {paragraph}
                    </p>
                  ))}
                </div>
                {isLong && !isExpanded && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-900 to-transparent light:from-slate-100" />
                )}
              </div>
              {isLong && (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  onClick={() => setIsExpanded((expanded) => !expanded)}
                  className="mt-2 text-xs font-medium text-blue-300 hover:text-blue-200 light:text-blue-700 light:hover:text-blue-800"
                >
                  {isExpanded ? "접기" : "더보기"}
                </button>
              )}
              <RelatedImages
                images={source.relatedImages || []}
                workspaceSlug={workspaceSlug}
              />
            </div>
          )}
        </section>
      )}
    </article>
  );
}

const CIRCLE_ICONS = {
  file: FileText,
  link: LinkSimple,
  youtube: YoutubeLogo,
  github: GithubLogo,
  gitlab: GitlabLogo,
  gitea: GitBranch,
  confluence: LinkSimple,
  drupalwiki: FileText,
  obsidian: FileText,
  paperlessNgx: FileText,
};

const CIRCLE_IMAGES = {
  gmailThread: GmailLogo,
  gmailAttachment: GmailLogo,
  googleCalendar: GoogleCalendarLogo,
  outlookThread: OutlookLogo,
  outlookAttachment: OutlookLogo,
};

/**
 * Returns the custom image for a given type, or null if no custom image is available.
 * @param {string} type
 * @returns {string|null}
 */
export function getCustomImage(type) {
  return CIRCLE_IMAGES[type] ?? null;
}

/**
 * Renders a circle with a source type icon inside, or a favicon if URL is provided.
 * @param {"file"|"link"|"youtube"|"github"|"gitlab"|"gitea"|"confluence"|"drupalwiki"|"obsidian"|"paperlessNgx"} props.type
 * @param {number} [props.size] - Circle diameter in px
 * @param {number} [props.iconSize] - Icon size in px
 * @param {string} [props.url] - Optional URL to fetch favicon from
 * @param {string} [props.customImage] - Optional custom image to display
 */
export function SourceTypeCircle({
  type = "file",
  size = 22,
  iconSize = 12,
  url = null,
  customImage = null,
}) {
  const Icon = CIRCLE_ICONS[type] || CIRCLE_ICONS.file;
  const [imgError, setImgError] = useState(false);

  let faviconUrl = null;
  if (type === "link" && url) {
    try {
      const hostname = new URL(url).hostname;
      faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
    } catch {
      faviconUrl = null;
    }
  }

  useEffect(() => {
    setImgError(false);
  }, [url]);

  return (
    <div
      className={`${customImage ? "bg-transparent border-none" : "bg-white light:bg-slate-100 border-zinc-800 light:border-white rounded-full"} flex items-center justify-center overflow-hidden`}
      style={{ width: size, height: size }}
    >
      {faviconUrl && !imgError ? (
        <img
          src={faviconUrl}
          alt="favicon"
          style={{ width: size, height: size }}
          className="object-cover"
          onError={() => setImgError(true)}
        />
      ) : customImage ? (
        <img
          src={customImage}
          alt={type}
          style={{ width: size, height: size }}
          className="object-contain bg-transparent"
        />
      ) : (
        <Icon size={iconSize} weight="bold" className="text-black" />
      )}
    </div>
  );
}

export function combineLikeSources(sources) {
  const combined = {};
  sources.forEach((source) => {
    const { id, title, chunkSource = "", score = null } = source;
    const text = source.excerpt || source.text || "";
    if (combined.hasOwnProperty(title)) {
      combined[title].chunks.push({ id, text, chunkSource, score });
      combined[title].references += 1;
    } else {
      combined[title] = {
        title,
        chunks: [{ id, text, chunkSource, score }],
        references: 1,
      };
    }
  });
  return Object.values(combined);
}

function normalizedSourcePage(source = {}) {
  if (Number.isInteger(source.page) && source.page > 0) return source.page;
  if (typeof source.page === "string" && /^\d+$/.test(source.page.trim()))
    return Number(source.page);
  return null;
}

function sourceIdentity(source = {}) {
  if (typeof source.pdfRef === "string" && source.pdfRef.trim())
    return `pdf:${source.pdfRef.trim()}`;
  const documentName = sourceDocumentName(source).trim().toLocaleLowerCase();
  return documentName ? `name:${documentName}` : null;
}

function sourceExcerpt(source = {}) {
  if (typeof source.excerpt === "string") return source.excerpt.trim();
  if (typeof source.text === "string") return source.text.trim();
  return "";
}

function mergeDirectImages(...groups) {
  const seen = new Set();
  return groups
    .flat()
    .filter((image) => {
      if (!image || typeof image !== "object") return false;
      const key = image.imageKey || image.image_key || image.hash;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

/**
 * Collapses only the employee-facing citation list. Retrieval evidence and
 * the sources sent to Gemini remain untouched.
 */
export function dedupeCitationSources(sources = []) {
  const result = [];
  const positions = new Map();

  sources.forEach((source, index) => {
    const page = normalizedSourcePage(source);
    const identity = sourceIdentity(source);
    const key = identity && page ? `${identity}|page:${page}` : `row:${index}`;

    if (!positions.has(key)) {
      positions.set(key, result.length);
      result.push(source);
      return;
    }

    const position = positions.get(key);
    const current = result[position];
    const representative =
      sourceExcerpt(source).length > sourceExcerpt(current).length
        ? source
        : current;
    result[position] = {
      ...representative,
      pdfRef: current.pdfRef || source.pdfRef,
      documentName: current.documentName || source.documentName,
      document_name: current.document_name || source.document_name,
      page: current.page ?? source.page,
      relatedImages: mergeDirectImages(
        current.relatedImages || [],
        source.relatedImages || []
      ),
    };
  });

  return result;
}

export default function Citations({
  sources = [],
  workspaceSlug,
  question = "",
  answer = "",
  aliases = [],
}) {
  const directlyRelevantSources = filterDirectCitationSources({
    question,
    answer,
    sources,
    aliases,
  });
  const visibleSources = dedupeCitationSources(directlyRelevantSources);
  if (visibleSources.length === 0) return null;

  return (
    <section
      className="mt-2 w-full max-w-[920px]"
      aria-label="출처 및 근거 원문"
    >
      <div className="w-full">
        {visibleSources.map((source, index) => (
          <SourceEvidenceRow
            key={`${sourceIdentity(source) || "source"}-${normalizedSourcePage(source) || index}`}
            source={source}
            index={index}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </div>
    </section>
  );
}

export function omitChunkHeader(text) {
  if (!text.includes("<document_metadata>")) return text;
  return text.split("</document_metadata>")[1].trim();
}

export function CitationDetailModal({ source, onClose }) {
  const { references, title, chunks } = source;
  const { isUrl, text: webpageUrl, href: linkTo } = parseChunkSource(source);
  const { t } = useTranslation();

  return (
    <Modal isOpen={!!source} onClose={onClose} size="lg">
      <ModalHeader
        title={
          isUrl ? (
            <a
              href={linkTo}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-x-1 max-w-full overflow-hidden hover:underline hover:text-blue-300 light:hover:text-blue-600"
            >
              <span className="truncate">{webpageUrl}</span>
              <ArrowSquareOut className="flex-shrink-0" />
            </a>
          ) : (
            truncate(title, 45)
          )
        }
        subtitle={
          references > 1 ? `Referenced ${references} times.` : undefined
        }
        onClose={onClose}
      />
      <ModalBody>
        {chunks.map(({ text, score }, idx) => (
          <Fragment key={idx}>
            <div className="text-zinc-100 light:text-slate-900">
              <div className="flex flex-col w-full justify-start gap-y-1">
                <SourceExcerpt text={text} />

                {!!score && (
                  <div className="w-full flex items-center text-xs text-zinc-400 light:text-slate-500 gap-x-2 cursor-default">
                    <div
                      data-tooltip-id="similarity-score"
                      data-tooltip-content={`This is the semantic similarity score of this chunk of text compared to your query calculated by the vector database.`}
                      className="flex items-center gap-x-1"
                    >
                      <Info size={14} />
                      <p>
                        {toPercentString(score)}{" "}
                        {t("chat_window.similarity_match")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {idx !== chunks.length - 1 && (
              <hr className="border-zinc-800 light:border-slate-200" />
            )}
          </Fragment>
        ))}
      </ModalBody>
    </Modal>
  );
}

const supportedSources = [
  "link://",
  "confluence://",
  "github://",
  "gitlab://",
  "gitea://",
  "drupalwiki://",
  "youtube://",
  "obsidian://",
  "paperless-ngx://",
  "gmail-thread://",
  "gmail-attachment://",
  "google-calendar://",
  "outlook-thread://",
  "outlook-attachment://",
];

/**
 * Parses the chunk source to get the correct title and/or display text for citations
 * which contain valid outbound links that can be clicked by the
 * user when viewing a citation. Optionally allows various icons
 * to show distinct types of sources.
 * @param {{title: string, chunks: {text: string, chunkSource: string}[]}} options
 * @returns {{isUrl: boolean, text: string, href: string, icon: string}}
 */
export function parseChunkSource({ title = "", chunks = [] }) {
  const nullResponse = {
    isUrl: false,
    text: null,
    href: null,
    icon: "file",
  };

  if (
    !chunks.length ||
    !supportedSources.some((source) =>
      chunks[0].chunkSource?.startsWith(source)
    )
  )
    return nullResponse;

  try {
    const sourceID = supportedSources.find((source) =>
      chunks[0].chunkSource?.startsWith(source)
    );
    let url, text, icon;

    // Try to parse the URL from the chunk source
    // If it fails, we'll use the title as the text and the link icon
    // but the document will not be linkable
    try {
      url = new URL(chunks[0].chunkSource.split(sourceID)[1]);
    } catch {}

    switch (sourceID) {
      case "link://":
        text = url.host + url.pathname;
        icon = "link";
        break;

      case "youtube://":
        text = title;
        icon = "youtube";
        break;

      case "github://":
        text = title;
        icon = "github";
        break;

      case "gitlab://":
        text = title;
        icon = "gitlab";
        break;

      case "gitea://":
        text = title;
        icon = "gitea";
        break;

      case "confluence://":
        text = title;
        icon = "confluence";
        break;

      case "drupalwiki://":
        text = title;
        icon = "drupalwiki";
        break;

      case "obsidian://":
        text = title;
        icon = "obsidian";
        break;

      case "paperless-ngx://":
        text = title;
        icon = "paperlessNgx";
        break;

      case "gmail-thread://":
        text = title;
        icon = "gmailThread";
        break;
      case "gmail-attachment://":
        text = title;
        icon = "gmailAttachment";
        break;

      case "google-calendar://":
        text = title;
        icon = "googleCalendar";
        break;

      case "outlook-thread://":
        text = title;
        icon = "outlookThread";
        break;

      case "outlook-attachment://":
        text = title;
        icon = "outlookAttachment";
        break;

      default:
        text = url.host + url.pathname;
        icon = "link";
        break;
    }

    return {
      isUrl: !!url,
      href: url?.toString() ?? "#",
      text,
      icon,
    };
  } catch (err) {
    console.warn(`Unsupported source identifier ${chunks[0].chunkSource}`, err);
  }
  return nullResponse;
}
