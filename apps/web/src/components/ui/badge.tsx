import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-medium", {
  variants: {
    variant: {
      default: "border-primary/40 bg-primary/15 text-link",
      success: "border-success/40 bg-success/15 text-success",
      warning: "border-warning/40 bg-warning/15 text-warning",
      danger: "border-destructive/40 bg-destructive/15 text-destructive",
      muted: "border-border bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "muted" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
