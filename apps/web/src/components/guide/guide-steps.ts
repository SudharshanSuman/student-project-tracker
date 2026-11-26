import type { Role } from "@iic/shared";

export type GuideIcon = "welcome" | "dashboard" | "board" | "milestones" | "attendance" | "users" | "reports" | "funding" | "notifications" | "done";

export interface GuideStep {
  icon: GuideIcon;
  title: string;
  body: string;
  /** Optional page the step talks about, shown as an "Open …" link. */
  link?: { href: string; label: string };
}

const ROLE_INTRO: Record<Role, string> = {
  ADMIN: "As an admin, you run the cell: invite people, set up cohorts and keep everything on track.",
  MENTOR: "As a mentor, you guide teams: review their milestones and keep an eye on progress.",
  PROJECT_LEAD: "As a project lead, you steer your team: plan the work, submit milestones and track funding.",
  PROJECT_MEMBER: "As a team member, you pick up tasks, move them forward and join events.",
};

const isStaff = (role: Role) => role === "ADMIN" || role === "MENTOR";

/** The welcome tour, tailored to what each role can actually see and do. */
export function guideSteps(role: Role, firstName: string): GuideStep[] {
  const steps: GuideStep[] = [
    {
      icon: "welcome",
      title: `Welcome, ${firstName}`,
      body: `Your project lives here: tasks, milestones, events and attendance in one place. ${ROLE_INTRO[role]} This tour takes about a minute.`,
    },
    {
      icon: "dashboard",
      title: "Start from the dashboard",
      body: "This is your home page. It shows what needs your attention today: open tasks, upcoming events and milestones waiting for action.",
      link: { href: "/dashboard", label: "Open dashboard" },
    },
    {
      icon: "board",
      title: "Move work on the board",
      body: "Tasks sit in four columns: To do, In progress, Review and Done. Drag a card to move it. Finished work goes to Review first, and the project lead moves it to Done.",
      link: { href: "/board", label: "Open Kanban board" },
    },
    {
      icon: "milestones",
      title: "Reach your milestones",
      body: isStaff(role)
        ? "Teams submit milestones here when they finish a stage. Open one to approve it, or request changes with a short note explaining what's missing."
        : "Every project grows through stages: Ideation, POC, MVP, Market testing and Pre-incubation. Complete a stage's milestones and submit them. A mentor approves them or asks for changes.",
      link: { href: "/milestones", label: "Open milestones" },
    },
    {
      icon: "attendance",
      title: "Check in at events",
      body: isStaff(role)
        ? "Open an attendance session for an event and show its QR code on screen. People scan it to check in, and the list fills in by itself."
        : "At an event, go to Attendance → Check in and scan the QR code on the screen. That's it: your attendance is recorded.",
      link: { href: "/attendance", label: "Open attendance" },
    },
  ];

  if (role === "ADMIN") {
    steps.push({
      icon: "users",
      title: "Invite your people",
      body: "Invite mentors, leads and members by email. Their role comes from the invitation. Under Integrations you can connect Discord and GitHub.",
      link: { href: "/admin/users", label: "Open users" },
    });
  } else if (role === "MENTOR") {
    steps.push({
      icon: "reports",
      title: "Share progress with reports",
      body: "Create PDF reports on projects, attendance, milestones and funding: handy for reviews and meetings.",
      link: { href: "/reports", label: "Open reports" },
    });
  } else if (role === "PROJECT_LEAD") {
    steps.push({
      icon: "funding",
      title: "Keep the funding ledger",
      body: "Record grants and expenses for your project. A mentor or admin verifies each entry, so the numbers stay trustworthy.",
      link: { href: "/funding", label: "Open funding ledger" },
    });
  }

  steps.push(
    {
      icon: "notifications",
      title: "Stay in the loop",
      body: "The bell at the top shows new notifications: task updates, milestone decisions and upcoming events. Keep your profile up to date so your team knows who you are.",
      link: { href: "/notifications", label: "Open notifications" },
    },
    {
      icon: "done",
      title: "You're all set",
      body: "Tip: install the app for one-tap access. On Android use Chrome's menu → Install app; on iPhone tap Share → Add to Home Screen. You can reopen this guide any time from the Guide button at the top.",
    },
  );

  return steps;
}
