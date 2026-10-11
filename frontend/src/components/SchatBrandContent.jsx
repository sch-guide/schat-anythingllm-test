import useSchatBrand from "@/hooks/useSchatBrand";
import { announcementActive } from "@/utils/schatBrand";
import SuggestedMessages from "@/components/lib/SuggestedMessages";

export function BrandAnnouncement() {
  const { brand, now } = useSchatBrand();
  if (!announcementActive(brand.announcement, now)) return null;
  return (
    <div
      role="status"
      className="absolute inset-x-0 top-16 md:top-0 z-30 truncate border-b border-sky-300 bg-sky-50 px-4 py-2 text-center text-sm text-sky-950 dark:bg-sky-950 dark:text-sky-100"
      title={brand.announcement.text}
    >
      {brand.announcement.text}
    </div>
  );
}
export function useBrandPanelStyle() {
  const { brand, now } = useSchatBrand();
  return announcementActive(brand.announcement, now)
    ? { paddingTop: "38px" }
    : undefined;
}
export function BrandWelcome() {
  const { brand } = useSchatBrand();
  return <>{brand.welcome.text}</>;
}
export function BrandExamples({ sendCommand, fallback = [] }) {
  const { brand } = useSchatBrand();
  return (
    <SuggestedMessages
      suggestedMessages={
        brand.welcome.examples.length
          ? brand.welcome.examples.map((message) => ({ heading: "", message }))
          : fallback
      }
      sendCommand={sendCommand}
    />
  );
}
