import { existsSync } from "node:fs";
import puppeteer, { type Browser } from "puppeteer-core";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * A fixed-size pool of headless Chromium instances. At most `size` browsers ever exist;
 * callers beyond that wait in a FIFO queue, so report load can never spawn unbounded
 * processes. Each browser is recycled after `maxUses` renders (bounds memory growth) and
 * replaced if it crashes. Idle browsers are closed after `idleMs`.
 */
interface Slot {
  browser: Browser | null;
  launching: Promise<Browser> | null;
  busy: boolean;
  uses: number;
  idleTimer: NodeJS.Timeout | null;
}

const CANDIDATE_PATHS = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];

export function resolveChromePath(): string | null {
  if (config.PUPPETEER_EXECUTABLE_PATH) return existsSync(config.PUPPETEER_EXECUTABLE_PATH) ? config.PUPPETEER_EXECUTABLE_PATH : null;
  return CANDIDATE_PATHS.find((p) => existsSync(p)) ?? null;
}

export class BrowserPool {
  private slots: Slot[];
  private waiters: ((slot: Slot) => void)[] = [];
  private closed = false;
  launches = 0;

  constructor(
    readonly size: number,
    private readonly maxUses = 50,
    private readonly idleMs = 5 * 60_000,
  ) {
    this.slots = Array.from({ length: size }, () => ({ browser: null, launching: null, busy: false, uses: 0, idleTimer: null }));
  }

  get activeBrowsers() {
    return this.slots.filter((s) => s.browser || s.launching).length;
  }

  private async launch(): Promise<Browser> {
    const executablePath = resolveChromePath();
    if (!executablePath) throw new Error("No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH (see docs/REPORTS.md).");
    this.launches += 1;
    const args = ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"];
    if (config.PUPPETEER_NO_SANDBOX === "true") args.push("--no-sandbox", "--disable-setuid-sandbox");
    return puppeteer.launch({ executablePath, headless: true, args });
  }

  private async browserFor(slot: Slot): Promise<Browser> {
    if (slot.browser?.connected) return slot.browser;
    slot.browser = null;
    slot.launching ??= this.launch().finally(() => {
      slot.launching = null;
    });
    const browser = await slot.launching;
    slot.browser = browser;
    slot.uses = 0;
    browser.once("disconnected", () => {
      if (slot.browser === browser) slot.browser = null;
    });
    return browser;
  }

  private acquireSlot(): Promise<Slot> {
    if (this.closed) return Promise.reject(new Error("Browser pool is closed"));
    const free = this.slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(slot: Slot) {
    const next = this.waiters.shift();
    if (next) return next(slot); // hand over directly; stays busy
    slot.busy = false;
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
      if (!slot.busy && slot.browser) {
        const b = slot.browser;
        slot.browser = null;
        void b.close().catch(() => undefined);
      }
    }, this.idleMs);
    slot.idleTimer.unref();
  }

  /** Runs `fn` with a browser from the pool; always returns the slot. */
  async use<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
    const slot = await this.acquireSlot();
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    try {
      const browser = await this.browserFor(slot);
      slot.uses += 1;
      return await fn(browser);
    } finally {
      if (slot.browser && slot.uses >= this.maxUses) {
        const b = slot.browser;
        slot.browser = null;
        await b.close().catch((err: unknown) => logger.warn({ err }, "browser recycle failed"));
      }
      this.releaseSlot(slot);
    }
  }

  async close() {
    this.closed = true;
    await Promise.all(
      this.slots.map(async (s) => {
        if (s.idleTimer) clearTimeout(s.idleTimer);
        const b = s.browser ?? (s.launching ? await s.launching.catch(() => null) : null);
        s.browser = null;
        await b?.close().catch(() => undefined);
      }),
    );
  }
}

let shared: BrowserPool | null = null;
export function browserPool(): BrowserPool {
  shared ??= new BrowserPool(config.REPORT_CONCURRENCY);
  return shared;
}
export async function closeBrowserPool() {
  if (shared) await shared.close();
  shared = null;
}
