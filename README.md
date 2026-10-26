# arobase.chat — front

The web app of [arobase.chat](https://arobase.chat), a decentralized, censorship-resistant social network. It is a static PWA (Vite, React, TanStack Query) that talks directly to EVM chains: there is no backend.

- **Identity**: a passkey (WebAuthn PRF) derives your account key. With a short-lived session key, you get no prompt on every action.
- **Posts and actions** are EIP-712 messages signed in the browser, then published to the contracts of [arobase-chat-evm-contracts](https://github.com/arobasechat/arobase-chat-evm-contracts).
- **Gas** is sponsored by onchain ERC-4337 paymasters through EIP-7702: users need no crypto to post, like or send messages.
- **Direct messages** are end-to-end encrypted (X25519 + XChaCha20-Poly1305).
- **Configuration** (chains, RPCs, parameters) is read from an onchain `Registry`, so any copy of this front, on any domain, shows the same network.

## Requirements

- Node.js 22+ and pnpm 10+
- A deployed instance: the `Registry` address and its chain, or a local stack from `arobase-chat-evm-contracts` (`pnpm dev`)

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then edit it
pnpm dev                     # http://localhost:5173
```

When you run `pnpm dev` in `arobase-chat-evm-contracts`, it writes `.env.local` for you if both repositories are cloned side by side.

### Environment

| Variable | Meaning |
|---|---|
| `VITE_REGISTRY_ADDRESS` | Address of the `Registry` proxy |
| `VITE_REGISTRY_CHAIN_ID` | Chain of the Registry (Gnosis = 100) |
| `VITE_REGISTRY_RPCS` | Comma-separated RPCs used to read the Registry. They must allow CORS. |
| `VITE_RP_ID` | Optional WebAuthn RP ID (defaults to the current hostname) |
| `VITE_DEV_CHAINS` | `true` for local anvil chains |
| `VITE_HASH_ROUTER` | `true` to use `#/` routes (for IPFS or any static host without SPA fallback) |
| `VITE_REPO_URL` | Link shown in the app for the source code |
| `VITE_EXTRA_BUNDLERS` | JSON `{ "chainId": ["https://…"] }` of extra ERC-4337 bundlers, tried first |

Never commit real values that are private (for example, a bundler URL that contains an API key). Use `.env.production.local`: every `.env*` file except `.env.example` is ignored by git.

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm typecheck` | Type-check every project (`tsc -b`) |
| `pnpm test` | Unit tests (service worker push security) |
| `pnpm build` | Production build in `dist/`, PWA included |
| `pnpm deploy:cf` | Build, then deploy to Cloudflare Workers (static assets, SPA fallback; see `wrangler.jsonc`) |

`dist/` is a plain static site: you can also publish it on any host or on IPFS (use `VITE_HASH_ROUTER=true`).

## Push notifications

`public/push-sw.js` (loaded by the Workbox service worker) displays the notifications sent by a [push relay](https://github.com/arobasechat/arobase-chat-push-relay). Its trust logic lives in `public/push-core.js` and does not trust the relay:
- every field is validated (type, addresses, ids, username format);
- texts are fixed, links are built by the app, and free text is only accepted for platform announcements, read from the chain;
- each notification's onchain proof is checked against the instance's RPCs. The app saves the RPCs and contract addresses for the service worker in Cache Storage (`src/lib/sw-config.ts`).

Anything that fails becomes a generic notification, and floods are collapsed. The settings offer the instance's verified relays first (`push.relays` parameter).

For a direct message, the relay sends no conversation id: the service worker finds the conversation itself from the rotating tag of the onchain event, with the tag keys the app saves next to the RPCs.

## Security

- **Content Security Policy** (`public/_headers`): scripts only from the app's origin, no plugins, no framing.
- **Images** are typed from their first bytes (PNG, JPEG, WebP, GIF), never from the MIME type stored onchain.
- **Direct messages**: invites hold no recipient and are found by trial decryption; messages use rotating tags and a throwaway sponsored sender; contacts' encryption keys are read from several RPCs and must agree; a safety code lets both sides check that nobody is in the middle; only a group's creator can change its members or rotate its key.
- **Sessions**: revoking a key (Settings, or on logout) signs one `Revoke` message and sends it to the social chain and every content chain. Changing the encryption key, roles or the username asks for the passkey.
- **Logout** wipes conversations, messages, notifications, bookmarks, drafts, push state and the service worker's configuration from the device.

```bash
pnpm test   # push-core and service worker tests (node:test)
```

## Passkeys and domains

Passkeys are bound to the domain they were created on. A mirror on another domain therefore starts with new accounts. To keep an existing identity, export its recovery key (Wallet → Advanced) and import it on the mirror.

## Translations

The UI strings are written in French and used directly as translation keys. English translations live in `src/i18n/en/*.ts`. Any new string wrapped in `t("…")` needs an English entry.

## Related repositories

- [arobase-chat-evm-contracts](https://github.com/arobasechat/arobase-chat-evm-contracts): Solidity contracts, deployment and local dev stack
- [arobase-chat-push-relay](https://github.com/arobasechat/arobase-chat-push-relay): decentralized Web Push relay and monitoring
- [arobase-chat-bundler-config](https://github.com/arobasechat/arobase-chat-bundler-config): Docker Compose setup for ERC-4337 bundlers, relay and monitor

## License

[Apache-2.0](LICENSE). Redistributions must keep the [NOTICE](NOTICE) file; please credit "arobase.chat" if you host a fork.
