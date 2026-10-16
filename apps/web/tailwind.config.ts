import type { Config } from "tailwindcss";

// Design tokens (Brutalist theme, SPT-8) are defined as CSS variables in globals.css
// and mapped here so components use semantic names (bg-card, text-muted, …).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--foreground))" },
        popover: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--border))",
        ring: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--foreground))" },
        link: "hsl(var(--link))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--background))" },
      },
      fontFamily: {
        // Brutalist: default-looking system fonts, no web fonts.
        sans: ["Arial", "Helvetica", "sans-serif"],
        mono: ['"Courier New"', "Courier", "monospace"],
      },
      // Lean bold: medium/semibold render as bold.
      fontWeight: { medium: "700", semibold: "700" },
    },
    // Sharp corners everywhere; only true circles (status dots) stay round.
    borderRadius: { none: "0", sm: "0", DEFAULT: "0", md: "0", lg: "0", xl: "0", "2xl": "0", "3xl": "0", full: "9999px" },
    // Structure comes from thick borders, never shadows or gradients.
    boxShadow: { none: "none", sm: "none", DEFAULT: "none", md: "none", lg: "none", xl: "none", "2xl": "none", inner: "none" },
    backgroundImage: {},
    // Thick, visible borders by default (`border` = 3px).
    borderWidth: { DEFAULT: "3px", 0: "0", 2: "2px", 3: "3px", 4: "4px", 8: "8px" },
    // Instant state changes: no transition or animation utilities exist.
    transitionDuration: { DEFAULT: "0ms", 0: "0ms" },
    transitionProperty: { none: "none" },
    animation: { none: "none" },
  },
  plugins: [],
};
export default config;
