import { Link } from "react-router-dom";
import { Empty } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function NotFound() {
  const t = useT();
  return (
    <Empty title={t("Page introuvable")}>
      <Link to="/" className="text-accent">
        {t("Retour à l'accueil")}
      </Link>
    </Empty>
  );
}
