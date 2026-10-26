import { memo } from "react";
import clsx from "clsx";
import type { Address } from "viem";
import { addressHue } from "@/lib/format";
import { gatewayUrl, isCid } from "@/lib/ipfs";
import { useConfig, useProfile } from "@/queries/core";
import { useOnchainImage } from "@/queries/media";

export const Avatar = memo(function Avatar({ address, size = 40, className }: { address: Address; size?: number; className?: string }) {
  const { data } = useProfile(address);
  const config = useConfig();
  const avatar = data?.avatar;
  const onchain = useOnchainImage(avatar);
  const hue = addressHue(address);
  const style = {
    width: size,
    height: size,
    background: `linear-gradient(135deg, hsl(${hue} 80% 62%), hsl(${(hue + 70) % 360} 75% 48%))`,
  };
  const src = onchain.url ?? (avatar && isCid(avatar) ? gatewayUrl(config.params.ipfsGateways ?? [], avatar) : undefined);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        className={clsx("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = (data?.name ?? address.slice(2, 3)).slice(0, 1).toUpperCase();
  return (
    <div
      className={clsx("flex shrink-0 select-none items-center justify-center rounded-full font-bold text-white", className)}
      style={{ ...style, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial}
    </div>
  );
});
