import { Link } from "react-router-dom";
import {
  Anchor,
  ArrowRight,
  BadgeCheck,
  Ban,
  Cloud,
  Eye,
  Fingerprint,
  Gift,
  Globe2,
  KeyRound,
  Layers,
  Lock,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Timer,
  Users,
  Vote,
} from "lucide-react";
import { env, repo } from "@/env";
import { useT } from "@/lib/i18n";
import { preloadPage } from "@/routes";
import {
  AppMock,
  ChainStrip,
  CodeBlock,
  DashedRule,
  Faq,
  Frame,
  LiveChains,
  LiveStats,
  MarketingFooter,
  MarketingHeader,
  MockWindow,
  SplitSection,
  Tag,
} from "@/components/marketing";

function PasskeyVisual() {
  const t = useT();
  return (
    <MockWindow>
      <div className="flex flex-col items-center py-6 text-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full bg-[rgb(var(--glow)/0.35)] blur-xl" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl border border-tag-line bg-tag text-tag-fg">
            <Fingerprint className="size-8" />
          </div>
        </div>
        <p className="text-sm font-medium">{t("Créer avec une passkey")}</p>
        <p className="mt-1 text-[12px] text-subtle">{t("Face ID · Touch ID · empreinte")}</p>
        <div className="mt-6 w-full space-y-2 text-left text-[12px]">
          {[
            [t("Identité"), "0x7a3f…91c2", t("dérivée de la passkey (PRF)")],
            [t("Chiffrement"), "X25519", t("pour vos messages privés")],
            [t("Session"), t("30 jours"), t("révocable à tout moment")],
          ].map(([k, v, h]) => (
            <div key={k} className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2">
              <span className="text-muted">{k}</span>
              <span className="text-right">
                <span className="font-mono">{v}</span>
                <span className="block text-[10px] text-subtle">{h}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </MockWindow>
  );
}

function ModerationVisual() {
  const t = useT();
  return (
    <MockWindow>
      <p className="mb-3 text-[11px] uppercase tracking-wider text-subtle">{t("Votre modération")}</p>
      <div className="space-y-2 text-[13px]">
        {[
          { icon: ShieldCheck, title: t("Politique de l'instance"), sub: t("Modérateurs + votes pondérés"), active: true },
          { icon: Users, title: t("Mes modérateurs"), sub: t("Les personnes que vous choisissez") },
          { icon: Eye, title: t("Vue brute"), sub: t("Aucun filtre") },
        ].map(({ icon: Icon, title, sub, active }) => (
          <div key={title} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${active ? "border-tag-line bg-tag" : "border-line bg-bg"}`}>
            <Icon className={`size-4 ${active ? "text-tag-fg" : "text-subtle"}`} />
            <span className="flex-1">
              <span className="block font-medium">{title}</span>
              <span className="text-[11px] text-subtle">{sub}</span>
            </span>
            <span className={`size-3.5 rounded-full border ${active ? "border-4 border-accent" : "border-line"}`} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5 text-[12px] text-muted">
        <Eye className="size-3.5" /> {t("Masqué par la modération")} — <span className="text-fg underline">{t("afficher quand même")}</span>
      </div>
    </MockWindow>
  );
}

function SponsorVisual() {
  const t = useT();
  return (
    <MockWindow>
      <p className="mb-3 text-[11px] uppercase tracking-wider text-subtle">{t("Publication")}</p>
      <div className="space-y-2 text-[12px]">
        {[
          { icon: KeyRound, label: t("Signature EIP-712"), state: t("local"), tone: "text-ok" },
          { icon: Timer, label: t("Preuve de travail"), state: t("0,8 s"), tone: "text-ok" },
          { icon: Layers, label: "UserOperation → bundler", state: t("envoyée"), tone: "text-ok" },
          { icon: Gift, label: t("Gas payé par le paymaster"), state: t("0 €"), tone: "text-accent" },
          { icon: BadgeCheck, label: t("Inclus dans un bloc"), state: t("confirmé"), tone: "text-ok" },
        ].map(({ icon: Icon, label, state, tone }) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2.5">
            <span className="flex items-center gap-2">
              <Icon className="size-3.5 text-accent" />
              {label}
            </span>
            <span className={tone}>{state}</span>
          </div>
        ))}
      </div>
    </MockWindow>
  );
}

export default function Landing() {
  const t = useT();
  return (
    <div className="min-h-dvh overflow-x-clip bg-bg text-fg">
      <MarketingHeader />

      <div className="relative">
        <div aria-hidden className="glow-top pointer-events-none absolute inset-x-0 top-0 h-[720px]" />
        <div aria-hidden className="dots mask-fade-b pointer-events-none absolute right-0 top-0 h-[520px] w-[60%] opacity-30" />

        <section className="relative mx-auto max-w-[1120px] px-5 pb-16 pt-20 sm:pt-28">
          <h1 className="display max-w-4xl text-[2.9rem] sm:text-[3.6rem] lg:text-[4.1rem]">
            {t("Un réseau social.")}
            <br />
            {t("Que personne ne peut éteindre.")}
          </h1>
          <p className="mt-8 max-w-xl text-[17px] leading-[1.65] text-muted">
            {t(
              "Postez, suivez, échangez en privé. Vos messages vivent sur des blockchains publiques et l'app tourne entièrement dans votre navigateur : aucun serveur à couper, aucun compte à suspendre.",
            )}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to="/bienvenue"
              onMouseEnter={() => preloadPage("onboarding")}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-primary-fg transition hover:opacity-90"
            >
              {t("Créer mon compte")}
            </Link>
            <Link
              to="/comment-ca-marche"
              className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] text-fg/90 transition hover:text-fg"
            >
              {t("Comment ça marche")} <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            <span>{t("Sans mot de passe")}</span>
            <span className="h-4 w-px bg-line" />
            <span className="flex items-center gap-1.5">
              <Fingerprint className="size-4" /> Passkey
            </span>
            <span className="h-4 w-px bg-line" />
            <span className="flex items-center gap-1.5">
              <Gift className="size-4" /> {t("Gas sponsorisé")}
            </span>
            <span className="h-4 w-px bg-line" />
            <span className="flex items-center gap-1.5">
              <Lock className="size-4" /> {t("DM chiffrés")}
            </span>
          </div>
        </section>

        <div className="relative px-5 pb-10">
          <AppMock />
        </div>
      </div>

      <Frame className="border-t border-line">
        <div className="px-6 py-16 text-center">
          <p className="mb-8 text-sm text-muted">{t("Vos données réparties sur plusieurs blockchains, lues directement par votre navigateur.")}</p>
          <ChainStrip />
        </div>
        <DashedRule />

        <SplitSection
          tag={t("Compte")}
          title={
            <>
              {t("Votre clé.")}
              <br />
              {t("Votre identité.")}
            </>
          }
          text={t(
            "Une passkey crée votre compte en quelques secondes. Pas d'email, pas de mot de passe : une clé qui ne quitte jamais votre appareil, synchronisée par iCloud ou Google.",
          )}
          features={[
            { icon: <Fingerprint className="size-4" />, label: t("Face ID, Touch ID ou empreinte") },
            { icon: <RefreshCcw className="size-4" />, label: t("Récupérable sur tous vos appareils") },
            { icon: <KeyRound className="size-4" />, label: t("Clé de session révocable") },
            { icon: <BadgeCheck className="size-4" />, label: t("Chaque action signée et vérifiée") },
          ]}
          visual={<PasskeyVisual />}
        />
        <DashedRule />

        <SplitSection
          id="chains"
          tag="Chains"
          reverse
          title={
            <>
              {t("Chaque donnée,")}
              <br />
              {t("au bon endroit.")}
            </>
          }
          text={t(
            "Les likes et abonnements vivent sur une seule chain sociale, pour que rien ne compte double. Les posts sont répliqués sur les chains de contenu. Pour l'essentiel, une copie peut être ancrée sur une chain majeure.",
          )}
          features={[
            { icon: <Users className="size-4" />, label: t("Chain sociale unique") },
            { icon: <Layers className="size-4" />, label: t("Contenu réplicable, même identifiant partout") },
            { icon: <Anchor className="size-4" />, label: t("Ancrage permanent optionnel") },
            { icon: <Ban className="size-4" />, label: t("Aucune fonction de suppression") },
          ]}
          visual={
            <div className="w-full max-w-[460px]">
              <LiveChains stacked />
              <p className="mt-3 text-center text-[12px] text-subtle">{t("Configuration lue en direct dans le contrat Registry")}</p>
            </div>
          }
        />
        <DashedRule />

        <SplitSection
          tag="Gas"
          title={
            <>
              {t("Gratuit.")}
              <br />
              {t("Sans intermédiaire.")}
            </>
          }
          text={t(
            "Un paymaster onchain paie le gas de vos actions. Ses règles sont publiques, n'importe qui peut l'alimenter, et n'importe quel bundler peut transmettre vos opérations.",
          )}
          features={[
            { icon: <Gift className="size-4" />, label: t("Posts, likes et messages sponsorisés") },
            { icon: <Timer className="size-4" />, label: t("Preuve de travail anti-spam") },
            { icon: <Layers className="size-4" />, label: "ERC-4337 + EIP-7702" },
            { icon: <ShieldCheck className="size-4" />, label: t("Repli sur votre propre gas") },
          ]}
          visual={<SponsorVisual />}
        />
      </Frame>

      <section className="relative overflow-hidden">
        <Frame className="border-y border-line">
          <div aria-hidden className="glow-band absolute inset-0" />
          <div aria-hidden className="dots mask-fade-y absolute inset-0 opacity-40" />
          <div className="relative px-6 py-20">
            <LiveStats />
          </div>
        </Frame>
      </section>

      <Frame>
        <SplitSection
          id="moderation"
          tag={t("Modération")}
          reverse
          title={
            <>
              {t("Masquer,")}
              <br />
              {t("jamais supprimer.")}
            </>
          }
          text={t(
            "Une instance peut masquer un contenu, par exemple illégal, mais aucun modérateur ne peut le faire disparaître du protocole. Vous choisissez quelle modération s'applique à votre fil.",
          )}
          features={[
            { icon: <ShieldCheck className="size-4" />, label: t("Politique de l'instance par défaut") },
            { icon: <Vote className="size-4" />, label: t("Votes pondérés anti-faux comptes") },
            { icon: <Scale className="size-4" />, label: t("Notes de la communauté (bridging)") },
            { icon: <Eye className="size-4" />, label: t("Vue brute disponible") },
          ]}
          visual={<ModerationVisual />}
        />
        <DashedRule />

        <div className="grid lg:grid-cols-2">
          <div className="px-6 py-20 sm:px-16 lg:border-r lg:border-line">
            <Tag>{t("Messages privés")}</Tag>
            <h2 className="display mt-5 text-[2.2rem] sm:text-[2.6rem]">
              {t("Chiffrés de bout")}
              <br />
              {t("en bout.")}
            </h2>
            <p className="mt-6 max-w-md text-[17px] leading-[1.65] text-muted">
              {t(
                "Conversations 1:1 et groupes chiffrés dans votre navigateur. Onchain, il n'y a que du texte illisible. Quand on retire un membre, la clé du groupe change.",
              )}
            </p>
          </div>
          <div id="instance" className="scroll-mt-16 px-6 py-20 sm:px-16">
            <Tag>Open source</Tag>
            <h2 className="display mt-5 text-[2.2rem] sm:text-[2.6rem]">
              {t("Votre instance,")}
              <br />
              {t("votre domaine.")}
            </h2>
            <p className="mt-6 max-w-md text-[17px] leading-[1.65] text-muted">
              {t("Le front, les contrats et les scripts sont ouverts. Publiez un miroir sur un autre domaine, ou déployez votre propre instance.")}
            </p>
            <div className="mt-6 max-w-md">
              <CodeBlock>{`git clone ${repo}/arobase-chat-front
cd arobase-chat-front && pnpm install && pnpm build`}</CodeBlock>
            </div>
            {env.repoUrl && (
              <a href={env.repoUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                {t("Voir sur GitHub")} <ArrowRight className="size-4" />
              </a>
            )}
          </div>
        </div>
        <DashedRule />

        <div className="grid md:grid-cols-2">
          <div className="flex gap-4 px-6 py-12 sm:px-16 md:border-r md:border-line">
            <Globe2 className="mt-1 size-5 shrink-0 text-accent" />
            <div>
              <p className="font-medium">{t("Accessible partout.")}</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                {t("Domaine bloqué ? Utilisez un miroir IPFS ou l'app installée. RPC bloqué ? Ajoutez-en un autre dans les réglages.")}
              </p>
            </div>
          </div>
          <div className="flex gap-4 px-6 py-12 sm:px-16">
            <Cloud className="mt-1 size-5 shrink-0 text-accent" />
            <div>
              <p className="font-medium">{t("Reprenez le contrôle.")}</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                {t("Pas d'algorithme opaque, pas de compte suspendu, pas de données revendues. Le protocole appartient à ceux qui l'utilisent.")}
              </p>
            </div>
          </div>
        </div>
        <DashedRule />

        <div className="px-6 py-20 sm:px-16">
          <h2 className="display mb-10 text-[2.2rem]">{t("Questions fréquentes")}</h2>
          <Faq
            items={[
              {
                q: t("Dois-je acheter de la crypto ?"),
                a: t("Non. Le gas des posts, likes et messages est sponsorisé. Seul l'ancrage optionnel sur une chain majeure est payant, et l'app vous l'indique avant."),
              },
              {
                q: t("Que se passe-t-il si je perds mon téléphone ?"),
                a: t(
                  "Votre passkey est synchronisée par iCloud Keychain ou Google Password Manager : même passkey, même compte sur un nouvel appareil. Une clé de secours est aussi exportable depuis le Portefeuille.",
                ),
              },
              {
                q: t("Qui peut supprimer mes messages ?"),
                a: t("Personne. Une instance peut masquer un contenu à l'affichage, mais il reste onchain, et chacun peut choisir une autre modération ou la vue brute."),
              },
              {
                q: t("Et si ce site est bloqué ?"),
                a: t("Les données ne sont pas sur ce site, elles sont sur les blockchains. N'importe quel miroir (IPFS, autre domaine) affiche les mêmes messages."),
              },
              {
                q: t("Mes messages privés sont-ils vraiment privés ?"),
                a: t(
                  "Le contenu est chiffré de bout en bout. Comme sur toute blockchain, on peut voir qu'une adresse a écrit, quand, et la taille du message : nous préférons le dire clairement.",
                ),
              },
            ]}
          />
        </div>
        <DashedRule />

        <div className="px-6 py-24 text-center">
          <h2 className="display text-[2.4rem] sm:text-[3rem]">{t("Votre voix, pour toujours.")}</h2>
          <p className="mx-auto mt-5 max-w-md text-[17px] text-muted">{t("Quelques secondes, aucune donnée personnelle.")}</p>
          <Link
            to="/bienvenue"
            className="mt-9 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-primary-fg transition hover:opacity-90"
          >
            {t("Ouvrir arobase.chat")}
          </Link>
        </div>
      </Frame>

      <MarketingFooter />
    </div>
  );
}
