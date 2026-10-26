import { expose } from "@/lib/worker-rpc";
import { verifyPrivate, verifyRaw, type PrivateMessage, type RawLog } from "@/lib/protocol";

const handlers = {
  verifyMany: (logs: RawLog[]) => Promise.all(logs.map(verifyRaw)),
  verifyPrivateMany: (items: { m: PrivateMessage; conv: `0x${string}` }[]) => Promise.all(items.map((i) => verifyPrivate(i.m, i.conv))),
};

export type VerifyHandlers = typeof handlers;
expose(handlers);
