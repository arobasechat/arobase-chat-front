export const gatewayUrl = (gateways: string[], cid: string) => `${(gateways[0] ?? "https://ipfs.io/ipfs/").replace(/\/?$/, "/")}${cid}`;

export const isCid = (s: string) => /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(s);
