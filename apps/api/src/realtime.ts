import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { sha256 } from "./lib/crypto.js";
import { logger } from "./logger.js";

/**
 * Minimal authenticated WebSocket channel at /ws: pushes "something changed"
 * hints (new notification, board updated). Clients refetch over REST, so the
 * socket never carries authoritative data and is safe to drop.
 */
const sockets = new Map<string, Set<WebSocket>>();

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function attachRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    try {
      if (!req.url?.startsWith("/ws")) return socket.destroy();
      const origin = req.headers.origin;
      if (origin && !config.webOrigins.includes(origin)) return socket.destroy();
      const token = readCookie(req, config.sessionCookie);
      if (!token) return socket.destroy();
      const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => {
        const set = sockets.get(session.userId) ?? new Set<WebSocket>();
        set.add(ws);
        sockets.set(session.userId, set);
        ws.on("close", () => set.delete(ws));
        ws.send(JSON.stringify({ type: "hello" }));
      });
    } catch (err) {
      logger.warn({ err }, "websocket upgrade failed");
      socket.destroy();
    }
  });
}

export function publishToUser(userId: string, payload: Record<string, unknown>) {
  const set = sockets.get(userId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(msg);
}
