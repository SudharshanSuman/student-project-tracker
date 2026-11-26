"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Bell, CalendarCheck, Columns3, Flag, FileText, Landmark, LayoutDashboard, LifeBuoy,
  PartyPopper, Sparkles, Users, type LucideIcon,
} from "lucide-react";
import type { Role } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { guideSteps, type GuideIcon } from "./guide-steps";

const ICONS: Record<GuideIcon, LucideIcon> = {
  welcome: Sparkles,
  dashboard: LayoutDashboard,
  board: Columns3,
  milestones: Flag,
  attendance: CalendarCheck,
  users: Users,
  reports: FileText,
  funding: Landmark,
  notifications: Bell,
  done: PartyPopper,
};

// Per user, so a shared lab computer still greets each new person once.
const seenKey = (userId: string) => `iic:guide-seen:${userId}`;

function hasSeen(userId: string): boolean {
  try {
    return window.localStorage.getItem(seenKey(userId)) === "1";
  } catch {
    return true; // Storage blocked (private mode): don't nag on every page load.
  }
}

function markSeen(userId: string) {
  try {
    window.localStorage.setItem(seenKey(userId), "1");
  } catch {
    /* ignore */
  }
}

/**
 * Welcome tour for new users. Opens by itself the first time someone signs in and can be
 * reopened from the "Guide" button it renders in the top bar.
 */
export function WelcomeTour({ userId, name, role }: { userId: string; name: string; role: Role }) {
  const firstName = name.trim().split(/\s+/)[0] || "there";
  const steps = useMemo(() => guideSteps(role, firstName), [role, firstName]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // Automated browsers (E2E tests, audits) would have the dialog cover the page they test.
    if (navigator.webdriver) return;
    if (!hasSeen(userId)) setOpen(true);
  }, [userId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      markSeen(userId);
      setIndex(0);
    }
  }

  // guideSteps always returns at least the welcome and closing steps.
  const step = steps[Math.min(index, steps.length - 1)] ?? steps[0]!;
  const Icon = ICONS[step.icon];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Open the user guide">
        <LifeBuoy className="h-4 w-4" />
        <span className="hidden sm:inline">Guide</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title={step.title} className="max-w-md gap-5">
          <div className="-order-1 grid h-11 w-11 place-items-center bg-foreground text-background" aria-hidden>
            <Icon className="h-5 w-5" />
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground" data-testid="guide-body">
            {step.body}
          </p>
          {step.link ? (
            <Link href={step.link.href} onClick={() => onOpenChange(false)} className="-mt-2 text-sm font-medium text-link hover:underline">
              {step.link.label} →
            </Link>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <div className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${steps.length}`} role="img">
              {steps.map((s, i) => (
                <span key={s.title} className={cn("h-1.5 w-1.5 rounded-full bg-border transition-colors", i === index && "w-4 bg-foreground")} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {isFirst ? (
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  Skip tour
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
                  <ArrowLeft /> Back
                </Button>
              )}
              {isLast ? (
                <Button size="sm" onClick={() => onOpenChange(false)}>
                  Get started
                </Button>
              ) : (
                <Button size="sm" onClick={() => setIndex(index + 1)} autoFocus>
                  {isFirst ? "Show me around" : "Next"} <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
