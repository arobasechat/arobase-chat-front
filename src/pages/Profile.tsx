import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, BadgeCheck, Calendar, Camera, Copy, Mail, MoreHorizontal, Shield, Users, VolumeX } from "lucide-react";
import { getAddress, isAddress, type Address } from "viem";
import { KIND, ROLE, ZERO32 } from "@/lib/protocol";
import { useOverlay } from "@/lib/social-queue";
import { compact, short, sameAddress } from "@/lib/format";
import { humanError } from "@/lib/tx";
import { AVATAR, compressImage, isOnchainRef, mediaChain, uploadOnchain } from "@/lib/media";
import { isCid, gatewayUrl } from "@/lib/ipfs";
import { useOnchainImage } from "@/queries/media";
import { useViewer } from "@/identity/store";
import { useConfig, useNetworks, usePlatform, useProfile, useUserStats } from "@/queries/core";
import { useFeed, useFollowers, useFollowing } from "@/queries/feed";
import { usePublish, useSocialActions } from "@/queries/actions";
import { useStartConversation } from "@/queries/dm";
import { useClaimHandle, useHandle, useHandleAvailability, useResolveHandle } from "@/queries/names";
import { HandleField, handleUsable } from "@/components/HandleField";
import { Avatar } from "@/components/Avatar";
import { Menu } from "@/components/Menu";
import { useSafetyFor } from "@/components/SafetySettings";
import { PostList } from "@/components/PostList";
import { DisplayName, UserLink } from "@/components/UserLink";
import { Badge, Button, Empty, Field, inputClass, Modal, Tabs } from "@/components/ui";
import { useLang, useT } from "@/lib/i18n";

function FollowButton({ address }: { address: Address }) {
  const viewer = useViewer();
  const stats = useUserStats(address);
  const overlay = useOverlay(`follow:${address.toLowerCase()}`);
  const actions = useSocialActions();
  const following = overlay !== undefined ? overlay === 1 : stats.data?.viewerFollows;
  const [hover, setHover] = useState(false);
  const t = useT();
  const platform = usePlatform();
  if (!viewer || sameAddress(viewer, address)) return null;
  if (platform && sameAddress(platform, address))
    return (
      <Button variant="outline" disabled title={t("Tout le monde suit automatiquement le compte de la plateforme.")}>
        {t("Suivi automatiquement")}
      </Button>
    );
  return (
    <Button
      variant={following ? "outline" : "primary"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => actions.follow(address, following ? 0 : 1)}
      className={following && hover ? "border-danger text-danger" : ""}
    >
      {following ? (hover ? t("Se désabonner") : t("Abonné")) : t("Suivre")}
    </Button>
  );
}

function AvatarPicker({ address, value, onChange }: { address: Address; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const networks = useNetworks();
  const config = useConfig();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onchain = useOnchainImage(value);
  const src = onchain.url ?? (isCid(value) ? gatewayUrl(config.params.ipfsGateways ?? [], value) : undefined);
  const available = !!mediaChain(networks, config);
  const pick = async (file: File) => {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await uploadOnchain(networks, config, await compressImage(file, AVATAR)));
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium">{t("Photo de profil")}</p>
      <div className="flex items-center gap-4">
        {src ? (
          <img src={src} alt="" className="size-16 shrink-0 rounded-full object-cover" />
        ) : value && isOnchainRef(value) ? (
          <div className="skeleton size-16 shrink-0 rounded-full" />
        ) : (
          <Avatar address={address} size={64} />
        )}
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          <Button size="sm" variant="outline" loading={busy} disabled={!available} onClick={() => fileRef.current?.click()}>
            <Camera className="size-4" /> {value ? t("Changer") : t("Choisir une photo")}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange("")}>
              {t("Retirer")}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {available
          ? t("Recadrée en carré, compressée puis stockée onchain. Sans photo, un avatar est généré à partir de votre adresse.")
          : t("Aucun stockage d'images configuré")}
      </p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

function EditProfile({ open, onClose, address }: { open: boolean; onClose: () => void; address: Address }) {
  const { data } = useProfile(address);
  const [name, setName] = useState(data?.name ?? "");
  const [bio, setBio] = useState(data?.bio ?? "");
  const [avatar, setAvatar] = useState(data?.avatar ?? "");
  const publish = usePublish();
  const current = useHandle(address).data ?? "";
  const [handle, setHandle] = useState(current);
  useEffect(() => {
    if (current) setHandle((h) => h || current);
  }, [current]);
  const handleState = useHandleAvailability(handle).state;
  const claim = useClaimHandle();
  const t = useT();
  const handleChanged = !!handle && handle !== current;
  const save = async () => {
    if (handleChanged) await claim.mutateAsync(handle);
    const changed = name.trim() !== (data?.name ?? "") || bio.trim() !== (data?.bio ?? "") || avatar !== (data?.avatar ?? "");
    if (changed) await publish.mutateAsync({ kind: KIND.PROFILE, extra: { name: name.trim(), bio: bio.trim(), ...(avatar ? { avatar } : {}) } });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={t("Modifier le profil")}>
      <div className="space-y-4">
        <HandleField value={handle} onChange={setHandle} />
        <Field label={t("Nom affiché")}>
          <input className={inputClass} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("Bio")}>
          <textarea className={inputClass} rows={3} value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <AvatarPicker address={address} value={avatar} onChange={setAvatar} />
        <p className="text-xs text-muted">{t("Le profil est un message signé (kind 3) : la dernière version publiée fait foi.")}</p>
        {(publish.error || claim.error) && <p className="text-sm text-danger">{humanError(publish.error ?? claim.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("Annuler")}
          </Button>
          <Button loading={publish.isPending || claim.isPending} disabled={handleChanged && !handleUsable(handleState)} onClick={() => void save().catch(() => undefined)}>
            {t("Enregistrer")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PeopleList({ addresses, empty }: { addresses: readonly Address[] | undefined; empty: string }) {
  if (!addresses) return null;
  if (!addresses.length) return <Empty title={empty} icon={<Users className="size-8" />} />;
  return (
    <ul>
      {addresses.map((a) => (
        <li key={a} className="flex items-center gap-3 border-b border-line px-4 py-3">
          <UserLink address={a}>
            <Avatar address={a} />
          </UserLink>
          <UserLink address={a} className="min-w-0 flex-1">
            <DisplayName address={a} className="block truncate font-bold hover:underline" />
            <span className="block truncate font-mono text-xs text-muted">{short(a, 6)}</span>
          </UserLink>
          <FollowButton address={a} />
        </li>
      ))}
    </ul>
  );
}

export default function Profile() {
  const params = useParams();
  const navigate = useNavigate();
  const raw = params.address ?? "";
  const byHandle = raw.startsWith("@");
  const resolved = useResolveHandle(byHandle ? raw.slice(1) : undefined);
  const target = byHandle ? (resolved.data ?? "") : raw;
  const valid = isAddress(target);
  const address = valid ? getAddress(target) : ("0x0000000000000000000000000000000000000000" as Address);
  const handle = useHandle(valid ? address : undefined).data;
  const viewer = useViewer();
  const isMe = sameAddress(viewer, address);
  const safety = useSafetyFor(address);
  const profile = useProfile(address);
  const stats = useUserStats(address);
  const isPlatform = sameAddress(usePlatform(), address);
  const [tab, setTab] = useState<"posts" | "followers" | "following">("posts");
  const posts = useFeed("author", valid ? address : undefined);
  const followers = useFollowers(tab === "followers" ? address : undefined);
  const following = useFollowing(tab === "following" ? address : undefined);
  const [editing, setEditing] = useState(false);
  const startConv = useStartConversation();
  const t = useT();
  const lang = useLang();

  if (byHandle && resolved.isPending) return <Empty title={t("Recherche de {name}…", { name: raw })} />;
  if (!valid) return <Empty title={byHandle ? t("{name} n'existe pas", { name: raw }) : t("Adresse invalide")} />;

  const s = stats.data;
  const name = profile.data?.name;
  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-6 border-b border-line bg-bg/85 px-4 py-2 backdrop-blur-md">
        <button onClick={() => navigate(-1)} className="rounded-full p-1.5 hover:bg-elevated" aria-label={t("Retour")}>
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{name || short(address)}</h1>
          <p className="text-xs text-muted">{posts.items.length > 0 ? t("{n}+ posts", { n: posts.items.length }) : t("Profil")}</p>
        </div>
      </div>

      <div className="relative h-28 overflow-hidden border-b border-line"><div className="glow-band absolute inset-0" /><div className="dots mask-fade-y absolute inset-0 opacity-40" /></div>
      <div className="px-4 pb-3">
        <div className="-mt-12 flex items-end justify-between">
          <Avatar address={address} size={96} className="border-4 border-bg" />
          <div className="flex gap-2">
            {!isMe && viewer && s?.encKey && s.encKey !== ZERO32 && (
              <Button
                variant="outline"
                loading={startConv.isPending}
                aria-label={t("Message privé")}
                onClick={() => startConv.mutate({ peers: [address] }, { onSuccess: (id) => navigate(`/messages/${id}`) })}
              >
                <Mail className="size-4" />
              </Button>
            )}
            {!isMe && viewer && (
              <Menu
                trigger={
                  <Button variant="outline" aria-label={t("Plus d'options")}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
                items={[
                  { label: safety.muted ? t("Réafficher ce compte") : t("Masquer ce compte"), icon: <VolumeX className="size-4" />, onSelect: () => safety.toggle("muted", !safety.muted) },
                  { label: safety.blocked ? t("Débloquer") : t("Bloquer"), icon: <Ban className="size-4" />, danger: !safety.blocked, onSelect: () => safety.toggle("blocked", !safety.blocked) },
                ]}
              />
            )}
            {isMe ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                {t("Éditer le profil")}
              </Button>
            ) : (
              <FollowButton address={address} />
            )}
          </div>
        </div>
        <div className="mt-3">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            {name || short(address)}
            {isPlatform && (
              <Badge tone="accent">
                <BadgeCheck className="size-3" /> {t("compte officiel")}
              </Badge>
            )}
            {s?.role === ROLE.ADMIN && (
              <Badge tone="accent">
                <Shield className="size-3" /> {t("admin")}
              </Badge>
            )}
            {s?.role === ROLE.MODERATOR && (
              <Badge tone="accent">
                <Shield className="size-3" /> {t("modérateur")}
              </Badge>
            )}
            {s?.followsViewer && <Badge>{t("vous suit")}</Badge>}
          </h2>
          <button
            onClick={() => void navigator.clipboard.writeText(address)}
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-sm text-muted hover:text-fg"
          >
            {handle && <span className="mr-1.5 font-sans text-[15px] text-muted">@{handle}</span>}
            {short(address, 6)} <Copy className="size-3" />
          </button>
        </div>
        {profile.data?.bio && <p className="mt-3 whitespace-pre-wrap text-[15px]">{profile.data.bio}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          {!!s?.firstSeen && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-4" /> {t("Actif depuis {date}", { date: new Date(s.firstSeen * 1000).toLocaleDateString(lang, { month: "long", year: "numeric" }) })}
            </span>
          )}
          {s && <span title={t("Poids de vote de modération (ancienneté + dépôt)")}>{t("Poids de vote {weight}", { weight: s.weight })}</span>}
        </div>
        <div className="mt-3 flex gap-5 text-sm">
          <button onClick={() => setTab("following")} className="hover:underline">
            <b>{compact.format(s?.following ?? 0)}</b> <span className="text-muted">{t("abonnements")}</span>
          </button>
          <button onClick={() => setTab("followers")} className="hover:underline">
            <b>{compact.format(s?.followers ?? 0)}</b> <span className="text-muted">{t("abonnés")}</span>
          </button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "posts", label: t("Posts") },
          { value: "followers", label: t("Abonnés") },
          { value: "following", label: t("Abonnements") },
        ]}
      />
      {tab === "posts" && (
        <PostList
          items={posts.items}
          loading={posts.isPending}
          hasNextPage={posts.hasNextPage}
          isFetchingNextPage={posts.isFetchingNextPage}
          fetchNextPage={posts.fetchNextPage}
          empty={
            <Empty title={t("Aucun post")}>
              {isMe ? (
                <Link to="/" className="text-accent">
                  {t("Publiez votre premier post")}
                </Link>
              ) : (
                t("Ce compte n'a encore rien publié sur les chains configurées.")
              )}
            </Empty>
          }
        />
      )}
      {tab === "followers" && <PeopleList addresses={followers.data} empty={t("Aucun abonné")} />}
      {tab === "following" && <PeopleList addresses={following.data} empty={t("Aucun abonnement")} />}
      {isMe && editing && <EditProfile open={editing} onClose={() => setEditing(false)} address={address} />}
    </>
  );
}
