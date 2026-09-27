import { useEffect, useMemo, useState } from "react";
import { CircleNotch, ImageBroken } from "@phosphor-icons/react";
import StorageFiles from "@/models/files";
import { openImageLightbox } from "@/components/ImageLightbox";
import { buildRelatedImagesModel } from "@/utils/schatRelatedImages";

function RelatedImage({ image, workspaceSlug }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let url = null;
    StorageFiles.documentImage(workspaceSlug, image.imageKey).then((blob) => {
      if (!active) return;
      if (!blob) return setFailed(true);
      url = URL.createObjectURL(blob);
      setObjectUrl(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image.imageKey, workspaceSlug]);

  return (
    <div className="min-w-0">
      <div className="h-40 w-full overflow-hidden rounded-lg bg-zinc-800 light:bg-slate-100">
        {!objectUrl && !failed && (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <CircleNotch size={24} className="animate-spin" />
          </div>
        )}
        {failed && (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <ImageBroken size={24} />
          </div>
        )}
        {objectUrl && (
          <img
            src={objectUrl}
            alt={image.alt}
            className="h-full w-full cursor-zoom-in object-contain"
            role="button"
            tabIndex={0}
            onClick={() =>
              openImageLightbox([
                { contentString: objectUrl, name: image.alt },
              ])
            }
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              openImageLightbox([
                { contentString: objectUrl, name: image.alt },
              ]);
            }}
          />
        )}
      </div>
      <p className="mt-2 truncate text-xs text-white/60 light:text-slate-500">
        {image.label}
      </p>
    </div>
  );
}

export default function RelatedImages({ images = [], workspaceSlug }) {
  const model = useMemo(() => buildRelatedImagesModel(images), [images]);
  if (!workspaceSlug || model.length === 0) return null;

  return (
    <section className="mt-5 w-full max-w-[780px]" aria-label="관련 이미지">
      <h3 className="mb-3 text-sm font-semibold text-white light:text-slate-900">
        관련 이미지
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {model.map((image) => (
          <RelatedImage
            key={image.imageKey}
            image={image}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </div>
    </section>
  );
}
