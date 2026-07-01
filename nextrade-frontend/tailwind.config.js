/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Core brand — deep navy, the "enterprise serious" base
        navy: {
          950: "#0A1325",
          900: "#101828",
          800: "#1B2A4A",
          700: "#27375C",
          600: "#3A4D78",
        },
        // AI / Intelligence accent — used ONLY for AI-generated content,
        // recommendations, confidence scores. Never used decoratively.
        // This is the visual signal that "AI touched this."
        intel: {
          500: "#0EA5A4",
          400: "#2DD4CF",
          100: "#CCFBF8",
          50: "#F0FDFC",
        },
        // Status colors
        success: { 600: "#16A34A", 100: "#DCFCE7" },
        warning: { 600: "#D97706", 100: "#FEF3C7" },
        danger: { 600: "#DC2626", 100: "#FEE2E2" },
        // Neutral surface
        surface: {
          page: "#F7F8FA",
          card: "#FFFFFF",
          border: "#E2E5EA",
          muted: "#6B7280",
          text: "#1F2937",
        },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.06), 0 1px 3px 0 rgb(16 24 40 / 0.10)",
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
};
