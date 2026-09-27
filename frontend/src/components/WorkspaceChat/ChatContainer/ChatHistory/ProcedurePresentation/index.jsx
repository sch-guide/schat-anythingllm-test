import { useMemo } from "react";
import { useSourcesSidebar } from "../../ChatSidebar";
import {
  buildProcedurePresentationModel,
  PROCEDURE_LAYOUT_CLASSES,
} from "@/utils/schatPresentation";

export default function ProcedurePresentation({ presentation, sources = [] }) {
  const { openSidebar } = useSourcesSidebar();
  const model = useMemo(
    () => buildProcedurePresentationModel(presentation, sources),
    [presentation, sources]
  );
  const answerBadges = useMemo(() => {
    if (!model) return [];
    const badges = new Map();
    for (const section of model.sections) {
      for (const item of section.items) {
        for (const badge of item.badges) {
          if (!badges.has(badge.index)) badges.set(badge.index, badge);
        }
      }
    }
    return [...badges.values()];
  }, [model]);

  if (!model) return null;

  return (
    <div
      className={`${PROCEDURE_LAYOUT_CLASSES} break-words text-white light:text-slate-900`}
      data-testid="procedure-presentation"
    >
      <p className="m-0 mb-7 text-[15px] md:text-base font-medium">
        {model.summary}
      </p>
      <div>
        {model.sections.map((section, sectionIndex) => (
          <section
            key={`${section.title}-${sectionIndex}`}
            className="mt-8 first:mt-0"
          >
            <h3 className="m-0 mb-3 text-[15px] md:text-base font-semibold">
              {sectionIndex + 1}단계. {section.title}
            </h3>
            <ul className="m-0 flex flex-col gap-y-2 p-0 list-none">
              {section.items.map((item, itemIndex) => (
                <li
                  key={`${item.text}-${itemIndex}`}
                  className="flex items-start gap-x-2"
                >
                  <span aria-hidden="true" className="flex-none font-semibold">
                    •
                  </span>
                  <span className="min-w-0">
                    <span>{item.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {answerBadges.length > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-0.5 font-medium text-zinc-400 light:text-slate-500">
            출처
          </span>
          {answerBadges.map((badge) => (
            <button
              key={badge.index}
              type="button"
              title={badge.title}
              aria-label={`출처 ${badge.index}: ${badge.title}`}
              onClick={() => openSidebar([badge.source])}
              className="font-medium text-sky-400 light:text-sky-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            >
              [{badge.index}]
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
