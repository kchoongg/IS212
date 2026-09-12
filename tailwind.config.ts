import type { Config } from "tailwindcss";

// ConnectSphere design tokens. See UI_DESIGN.md §5.
//
// Semantic names, not raw hues: a screen says `bg-surface` and `text-ink-2`,
// never `bg-white text-slate-500`. Retuning the brand then happens here once
// instead of across forty files.
//
// The palette is warm throughout — an ivory ground rather than a blue-grey
// one — so the product reads as an established services firm rather than a
// default admin panel. Deep teal carries every primary action; clay is the
// single accent and is spent sparingly.

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        /// Page background. Warm ivory, never pure white — white pages glare
        /// under venue lighting and flatten the cards sitting on them.
        ground: "#FBFAF7",
        /// Cards, tables, the top bar, the sidebar.
        surface: "#FFFFFF",
        /// Inset areas: table headers, form footers, dialog footers.
        "surface-2": "#F5F3ED",

        /// Hairlines and card edges.
        line: "#E7E3DA",
        /// Input borders, which need to read as interactive.
        "line-strong": "#D6D1C4",

        /// Body copy and headings.
        ink: "#1B211F",
        /// Secondary text: subtitles, table meta, hints.
        "ink-2": "#4A5551",
        /// Placeholders, disabled text, timestamps.
        "ink-3": "#7A847F",

        /// Deep teal. Every primary action, the active nav rule, focus rings.
        brand: {
          50: "#EDF4F2",
          100: "#D6E6E3",
          200: "#B3D1CC",
          600: "#0F5C57",
          700: "#0C4A46",
          900: "#062E2B",
        },

        /// Clay. One accent, used for the single highest-value call to action
        /// on a screen and nowhere else.
        clay: {
          50: "#FBF0EB",
          200: "#F0CFC2",
          600: "#B4553A",
          700: "#99432C",
        },

        /// Status tones (§5.2). Warm-tuned so badges sit on ivory without
        /// looking pasted in from another system. Each pair is checked for
        /// 4.5:1 text contrast on its own background.
        tone: {
          "neutral-bg": "#F2EFE8",
          "neutral-fg": "#545D59",
          "neutral-ring": "#E2DDD1",
          "info-bg": "#EDF4F2",
          "info-fg": "#0C4A46",
          "info-ring": "#B3D1CC",
          "progress-bg": "#E9EDF5",
          "progress-fg": "#33507A",
          "progress-ring": "#C8D5E8",
          "success-bg": "#E8F2E6",
          "success-fg": "#2F6033",
          "success-ring": "#C6DCC3",
          "warning-bg": "#FBF1DF",
          "warning-fg": "#7E5510",
          "warning-ring": "#EEDAAA",
          "danger-bg": "#FAEAE5",
          "danger-fg": "#9B3A22",
          "danger-ring": "#EFCCC0",
        },
      },

      fontFamily: {
        /// Body, data, controls. Geist is vendored in src/app/fonts, so the
        /// interface never waits on a font host.
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        /// Page titles and card headings only. The serif is what makes the
        /// product read as editorial rather than as a dashboard template.
        display: ["var(--font-display)", "Georgia", "Cambria", "serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },

      borderRadius: {
        md: "6px",
        lg: "10px",
      },

      boxShadow: {
        /// Cards lift off the ivory ground by a hair, not by a drop shadow.
        card: "0 1px 2px rgba(27, 33, 31, 0.04), 0 1px 3px rgba(27, 33, 31, 0.03)",
        /// Dialogs and the mobile slide-over.
        raised: "0 16px 40px rgba(27, 33, 31, 0.16)",
      },
    },
  },
  plugins: [],
};

export default config;
