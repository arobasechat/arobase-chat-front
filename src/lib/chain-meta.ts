import { tr } from "./i18n";

export type ChainMeta = {
  asset: string;
  assetName: string;
  network: string;
  explorer?: string;
  howTo: string[];
};

const KNOWN: Record<number, ChainMeta> = {
  100: {
    asset: "xDAI",
    assetName: "xDAI, le dollar natif de Gnosis (1 xDAI ≈ 1 $)",
    network: "Gnosis Chain",
    explorer: "https://gnosisscan.io/address/",
    howTo: [
      "Sur votre exchange (Kraken, Binance, Bitget…), choisissez « Retirer » puis xDAI, USDC ou DAI.",
      "Sélectionnez le réseau « Gnosis Chain » (parfois noté « Gnosis » ou « xDAI »).",
      "Collez votre adresse ci-dessus. Depuis un wallet, vous pouvez aussi passer par bridge.gnosischain.com.",
    ],
  },
  5042: {
    asset: "USDC",
    assetName: "USDC, le gas natif d'Arc (1 USDC = 1 $)",
    network: "Arc",
    explorer: "https://explorer.arc.io/address/",
    howTo: [
      "Si votre exchange propose le réseau « Arc », retirez de l'USDC directement vers votre adresse.",
      "Sinon, envoyez de l'USDC depuis une autre chain avec le bridge officiel de Circle (CCTP).",
      "Vérifiez toujours que le réseau de destination est bien « Arc ».",
    ],
  },
  42161: {
    asset: "ETH",
    assetName: "ETH sur Arbitrum",
    network: "Arbitrum One",
    explorer: "https://arbiscan.io/address/",
    howTo: [
      "Sur votre exchange, choisissez « Retirer » puis ETH.",
      "Sélectionnez le réseau « Arbitrum One », et surtout pas « Ethereum » : les frais sont bien plus élevés et les fonds n'arriveraient pas au bon endroit.",
      "Collez votre adresse ci-dessus.",
    ],
  },
  8453: {
    asset: "ETH",
    assetName: "ETH sur Base",
    network: "Base",
    explorer: "https://basescan.org/address/",
    howTo: [
      "Sur votre exchange (Coinbase, Kraken, Binance…), choisissez « Retirer » puis ETH.",
      "Sélectionnez le réseau « Base ».",
      "Collez votre adresse ci-dessus.",
    ],
  },
  137: {
    asset: "POL",
    assetName: "POL (ex-MATIC), le gas natif de Polygon",
    network: "Polygon PoS",
    explorer: "https://polygonscan.com/address/",
    howTo: [
      "Sur votre exchange, choisissez « Retirer » puis POL (anciennement MATIC).",
      "Sélectionnez le réseau « Polygon » (Polygon PoS), pas « Ethereum ».",
      "Collez votre adresse ci-dessus.",
    ],
  },
};

export function chainMeta(chainId: number, name: string): ChainMeta {
  const known = KNOWN[chainId];
  if (known) return { ...known, assetName: tr(known.assetName), howTo: known.howTo.map((h) => tr(h)) };
  if (chainId >= 31337 && chainId <= 31399)
    return { asset: "ETH", assetName: tr("ETH de test (chain locale)"), network: name, howTo: [tr("Utilisez le bouton « Créditer » : la chain locale vous envoie des fonds de test.")] };
  return { asset: "gas", assetName: tr("le jeton natif de {name}", { name }), network: name, howTo: [tr("Envoyez le jeton natif de {name} à votre adresse, sur le réseau {name}.", { name })] };
}

export const txUrl = (chainId: number, hash: string) => {
  const base = KNOWN[chainId]?.explorer;
  return base ? `${base.replace(/address\/$/, "tx/")}${hash}` : undefined;
};

export const addressUrl = (chainId: number, address: string) => {
  const base = KNOWN[chainId]?.explorer;
  return base ? `${base}${address}` : undefined;
};

export function formatAmount(wei: bigint, digits = 4) {
  const n = Number(wei) / 1e18;
  if (n === 0) return "0";
  if (n < 0.0001) return `< 0,0001`;
  return n.toLocaleString("fr", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
