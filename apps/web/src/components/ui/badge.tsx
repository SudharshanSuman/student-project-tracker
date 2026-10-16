import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 border-2 border-foreground px-2 py-0.5 text-[11px] font-bold uppercase", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      success: "bg-success text-foreground",
      warning: "bg-warning text-foreground",
      danger: "bg-destructive text-foreground",
      muted: "bg-background text-foreground",
    },
  },
  defaultVariants: { variant: "muted" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
