import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, Info } from "lucide-react";
import { env, repo } from "@/env";
import { useT } from "@/lib/i18n";
import { CodeBlock, Frame, LiveChains, MarketingFooter, MarketingHeader, Tag } from "@/components/marketing";

const TOC = [
  { id: "principe", label: "Le principe" },
  { id: "compte", label: "Votre compte" },
  { id: "chains", label: "Les chains" },
  { id: "gas", label: "Le gas sponsorisé" },
  { id: "moderation", label: "La modération" },
  { id: "messages", label: "Messages privés" },
  { id: "instance", label: "Instances & miroirs" },
  { id: "limites", label: "Limites assumées" },
];

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-dashed border-line pb-14 pt-14 first:pt-0 last:border-0">
      <h2 className="display mb-6 text-[1.9rem]">{title}</h2>
      <div className="space-y-4 text-[16px] leading-[1.7] text-muted [&_b]:font-medium [&_b]:text-fg">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-tag-line bg-tag p-4 text-[15px] text-tag-fg">
      <Info className="mt-0.5 size-5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export default function About() {
  const t = useT();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [hash]);

  return (
    <div className="min-h-dvh overflow-x-clip bg-bg text-fg">
      <MarketingHeader />
      <div className="relative">
        <div aria-hidden className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
        <div className="relative mx-auto max-w-[1120px] px-5 pb-16 pt-20">
          <Tag>Documentation</Tag>
          <h1 className="display mt-5 text-[2.8rem] sm:text-[3.4rem]">{t("Comment ça marche")}</h1>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.65] text-muted">{t("Tout ce qu'il faut savoir pour comprendre arobase.chat, en langage clair.")}</p>
        </div>
      </div>
      <Frame className="border-t border-line">
      <div className="px-6 py-14 sm:px-16">
        <div className="grid gap-12 lg:grid-cols-[200px_1fr]">
          <nav className="hidden lg:block">
            <ul className="sticky top-24 space-y-1 text-sm">
              {TOC.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="block rounded-md px-3 py-1.5 text-muted transition hover:text-fg">
                    {t(item.label)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="max-w-3xl">
            <Chapter id="principe" title={t("Le principe")}>
              <p>
                {t(
                  "Sur un réseau social classique, vos messages sont stockés sur les serveurs d'une entreprise. Elle peut les supprimer, et un État peut la forcer à couper le service.",
                )}
              </p>
              <p>
                {t("arobase.chat fonctionne autrement.")} <b>{t("Il n'y a pas de serveur.")}</b>{" "}
                {t(
                  "L'application tourne entièrement dans votre navigateur : elle signe vos messages avec votre clé, les publie sur des blockchains publiques, puis les relit directement depuis ces blockchains.",
                )}
              </p>
              <Callout>
                {t(
                  "Le site que vous consultez n'est qu'une porte d'entrée. Les données ne sont pas « chez nous » : elles sont sur les blockchains. Si ce site disparaît, un miroir affichera exactement les mêmes messages.",
                )}
              </Callout>
            </Chapter>

            <Chapter id="compte" title={t("Votre compte : une passkey, pas un mot de passe")}>
              <p>
                {t("À l'inscription, votre appareil crée une")} <b>passkey</b>{" "}
                {t("(Face ID, Touch ID, empreinte ou code). Une clé cryptographique en est dérivée : son adresse publique devient votre identité.")}
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <b>{t("Pas d'email, pas de mot de passe")}</b>
                  {t(", aucune donnée personnelle.")}
                </li>
                <li>
                  <b>{t("Récupération")}</b>
                  {t(" : la passkey est synchronisée par iCloud Keychain ou Google Password Manager. Sur un nouvel appareil, vous retrouvez le même compte.")}
                </li>
                <li>
                  <b>{t("Clé de session")}</b>
                  {t(
                    " : pour ne pas demander Face ID à chaque like, une clé locale est autorisée une fois. Elle ne sert qu'à publier, expire après 30 jours et peut être révoquée.",
                  )}
                </li>
                <li>
                  <b>{t("Clé de secours")}</b>
                  {t(" : une passkey est liée au domaine du site. Pour utiliser un miroir sur un autre domaine, exportez votre clé depuis le Portefeuille.")}
                </li>
              </ul>
            </Chapter>

            <Chapter id="chains" title={t("Les chains et leurs rôles")}>
              <p>{t("Une blockchain est un registre public répliqué sur des milliers de machines. arobase.chat en utilise plusieurs, chacune pour un rôle précis :")}</p>
              <LiveChains />
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <b>{t("Une seule chain sociale.")}</b>{" "}
                  {t(
                    "Les likes et les abonnements sont des compteurs. Si un like existait sur deux chains, il compterait double. On les regroupe donc sur une chain unique, ancienne et décentralisée.",
                  )}
                </li>
                <li>
                  <b>{t("Le contenu est réplicable.")}</b>{" "}
                  {t(
                    "Un post a le même identifiant partout : c'est le hash de votre signature. Il peut donc être copié sur autant de chains qu'on veut, sans doublon.",
                  )}
                </li>
                <li>
                  <b>{t("L'ancrage est optionnel et payant.")}</b>{" "}
                  {t(
                    "Pour un contenu sensible, cochez une chain d'ancrage (Arbitrum, Base, Polygon) : une copie y est gravée, sur une chain qui ne peut ni disparaître ni être contrôlée par une seule entité.",
                  )}
                </li>
              </ul>
              <p>
                {t("La liste des chains vit elle-même onchain, dans un contrat")} <b>Registry</b>
                {t(". L'app la lit au démarrage, et vous pouvez forcer votre propre liste ou ajouter vos RPC dans les réglages.")}
              </p>
            </Chapter>

            <Chapter id="gas" title={t("Le gas sponsorisé")}>
              <p>
                {t("Écrire sur une blockchain coûte des frais, appelés le « gas ». Sur arobase.chat, ils sont payés pour vous par un")} <b>paymaster</b>
                {t(" : un contrat qui dispose d'un budget et de règles publiques.")}
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>{t("Il ne paie que les actions arobase.chat : posts, commentaires, likes, abonnements, messages.")}</li>
                <li>
                  {t("Pour éviter le spam, votre navigateur calcule une petite")} <b>{t("preuve de travail")}</b>{" "}
                  {t("(environ une seconde) avant chaque action.")}
                </li>
                <li>
                  {t("Votre action est transmise par un")} <b>bundler</b>
                  {t(". N'importe lequel fait l'affaire, et vous pouvez ajouter le vôtre dans les réglages.")}
                </li>
                <li>
                  {t("N'importe qui peut")} <b>{t("alimenter le budget")}</b>{" "}
                  {t("du paymaster. S'il est vide, l'app vous propose de payer vous-même quelques centimes.")}
                </li>
              </ul>
            </Chapter>

            <Chapter id="moderation" title={t("La modération : masquer, jamais supprimer")}>
              <p>
                {t("Les contrats n'ont pas de fonction de suppression. La modération agit uniquement sur")} <b>{t("l'affichage")}</b>
                {t(", et vous choisissez laquelle vous appliquez :")}
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <b>{t("Politique de l'instance")}</b>{" "}
                  {t(
                    "(par défaut) : les modérateurs nommés par les administrateurs, plus les votes de la communauté. Un vote pèse selon l'ancienneté du compte et le dépôt anti-spam : les faux comptes créés à la chaîne ne pèsent rien.",
                  )}
                </li>
                <li>
                  <b>{t("Vos modérateurs")}</b>
                  {t(" : choisissez à qui vous faites confiance.")}
                </li>
                <li>
                  <b>{t("Vue brute")}</b>
                  {t(" : aucun filtre.")}
                </li>
              </ul>
              <p>
                {t("Les rôles d'admin et de modérateur, ainsi que chaque décision, sont des messages onchain, publics et traçables. Les")}{" "}
                <b>{t("notes de la communauté")}</b>{" "}
                {t(
                  "s'affichent seulement si des personnes habituellement en désaccord les jugent utiles : c'est l'algorithme « bridging », celui de X, réimplémenté en open source.",
                )}
              </p>
              <Callout>
                {t("L'instance officielle masque les contenus illégaux, par exemple au titre du DSA en Europe. Le protocole, lui, reste ouvert.")}
              </Callout>
            </Chapter>

            <Chapter id="messages" title={t("Messages privés")}>
              <p>
                {t("Les conversations 1:1 et de groupe sont")} <b>{t("chiffrées de bout en bout")}</b>{" "}
                {t(
                  "dans votre navigateur (X25519 + XChaCha20-Poly1305). Onchain, on ne voit que du texte illisible. Quand on retire quelqu'un d'un groupe, la clé change, et il ne peut plus lire la suite.",
                )}
              </p>
            </Chapter>

            <Chapter id="instance" title={t("Instances et miroirs")}>
              <p>
                {t("Une")} <b>instance</b>
                {t(", c'est un Registry (la configuration onchain) et un front qui pointe dessus. Le code est open source :")}
              </p>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <b>{t("Un miroir")}</b>{" "}
                  {t("réutilise le Registry de cette instance : mêmes messages, nouveau domaine. Si un nom de domaine est bloqué, il suffit d'en publier un autre.")}
                </li>
                <li>
                  <b>{t("Une nouvelle instance")}</b> {t("déploie ses propres contrats, ses chains et sa politique de modération.")}
                </li>
              </ul>
              <CodeBlock>{`git clone --recursive ${repo}/arobase-chat-evm-contracts
git clone ${repo}/arobase-chat-front
cd arobase-chat-evm-contracts && pnpm install
pnpm dev                     # ${t("tout en local : 3 chains, bundlers, données de démo")}
pnpm deploy:chains           # ${t("votre instance en production")}
cd ../arobase-chat-front && pnpm install && pnpm build  # ${t("publiez dist/ où vous voulez (Cloudflare, IPFS…)")}`}</CodeBlock>
              <p>
                {t("La configuration d'une instance est modifiée par un")} <b>Timelock</b>
                {t(" : chaque changement est public et ne s'applique qu'après un délai. Aucune clé unique ne peut tout changer du jour au lendemain.")}
              </p>
              {env.repoUrl && (
                <a href={env.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-semibold text-accent hover:underline">
                  {t("Code source sur GitHub")} <ArrowRight className="size-4" />
                </a>
              )}
            </Chapter>

            <Chapter id="limites" title={t("Limites assumées")}>
              <ul className="list-disc space-y-2 pl-6">
                <li>
                  <b>{t("Tout est public et permanent.")}</b> {t("Réfléchissez avant de publier : même masqué, un message reste onchain.")}
                </li>
                <li>
                  <b>{t("Métadonnées visibles.")}</b>{" "}
                  {t("Pour les messages privés, on peut voir qu'une adresse a écrit, quand, et la taille du message.")}
                </li>
                <li>
                  <b>{t("La chain sociale est un point unique.")}</b>{" "}
                  {t("Nous avons choisi une chain ancienne et très décentralisée pour limiter ce risque.")}
                </li>
                <li>
                  <b>{t("Appareils récents requis")}</b> {t("pour les passkeys PRF (iOS 18+, Android ou Chrome récents).")}
                </li>
              </ul>
            </Chapter>

            <div className="mt-12 rounded-xl border border-line bg-surface p-10 text-center">
              <h2 className="display text-[2rem]">{t("Prêt à essayer ?")}</h2>
              <Link to="/bienvenue" className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 font-medium text-primary-fg hover:opacity-90">
                {t("Créer mon compte")} <ArrowRight className="size-4" />
              </Link>
            </div>
          </article>
        </div>
      </div>
      </Frame>
      <MarketingFooter />
    </div>
  );
}
