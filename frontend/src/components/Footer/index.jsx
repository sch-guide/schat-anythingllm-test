import SettingsButton from "../SettingsButton";
import useUser from "@/hooks/useUser";
import {
  BookOpen,
  DiscordLogo,
  GithubLogo,
  Briefcase,
  Envelope,
  Globe,
  HouseLine,
  Info,
  LinkSimple,
} from "@phosphor-icons/react";

// Kept for the existing admin footer-customization form. SCHAT's sidebar
// intentionally does not render these optional links.
export const MAX_ICONS = 3;
export const ICON_COMPONENTS = {
  BookOpen,
  DiscordLogo,
  GithubLogo,
  Envelope,
  LinkSimple,
  HouseLine,
  Globe,
  Briefcase,
  Info,
};

export default function Footer() {
  const { user } = useUser();
  if (user && user.role !== "admin") return null;

  return (
    <div className="flex justify-center mb-2">
      <SettingsButton />
    </div>
  );
}
