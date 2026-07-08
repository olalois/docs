import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0e0e0e",
          dim: "#121212",
          bright: "#1a1a1a",
          "container-lowest": "#080808",
          "container-low": "#0e0e0e",
          container: "#141414",
          "container-high": "#1a1a1a",
          "container-highest": "#212121",
        },
        primary: {
          DEFAULT: "#c6c6c7",
          container: "#3a3a3b",
          "on-primary": "#0e0e0e",
          "on-container": "#e2e2e3",
        },
        secondary: {
          DEFAULT: "#9c9e9c",
          container: "#2e2f2e",
          "on-secondary": "#0e0e0e",
          "on-container": "#c6c8c6",
        },
        error: {
          DEFAULT: "#ee7d77",
          container: "#4a2522",
          "on-error": "#0e0e0e",
          "on-container": "#f4a9a5",
        },
        tertiary: {
          DEFAULT: "#22c55e",
          container: "#1a3a2a",
          "on-tertiary": "#0e0e0e",
          "on-container": "#86efac",
        },
        outline: {
          DEFAULT: "#767575",
          variant: "#444444",
        },
        "on-surface": "#e6e1e5",
        "on-surface-variant": "#c4c7c5",
        inverse: {
          surface: "#e6e1e5",
          "on-surface": "#1c1b1f",
          primary: "#3a3a3b",
        },
      },
      borderRadius: {
        none: "0px",
        sm: "0px",
        DEFAULT: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
        full: "9999px",
      },
      fontFamily: {
        headline: ['"Space Grotesk"', "sans-serif"],
        label: ['"Inter"', "sans-serif"],
        body: ['"Inter"', "sans-serif"],
        mono: ['"JetBrains Mono"', '"Space Grotesk"', "monospace"],
      },
      fontSize: {
        "display-lg": [
          "3.5625rem",
          { lineHeight: "4rem", letterSpacing: "-0.015em", fontWeight: "400" },
        ],
        "display-md": [
          "2.8125rem",
          {
            lineHeight: "3.25rem",
            letterSpacing: "-0.01em",
            fontWeight: "400",
          },
        ],
        "display-sm": [
          "2.25rem",
          { lineHeight: "2.75rem", letterSpacing: "0", fontWeight: "400" },
        ],
        "headline-lg": [
          "2rem",
          { lineHeight: "2.5rem", letterSpacing: "0", fontWeight: "600" },
        ],
        "headline-md": [
          "1.75rem",
          { lineHeight: "2.25rem", letterSpacing: "0", fontWeight: "600" },
        ],
        "headline-sm": [
          "1.5rem",
          { lineHeight: "2rem", letterSpacing: "0", fontWeight: "600" },
        ],
        "title-lg": [
          "1.375rem",
          { lineHeight: "1.75rem", letterSpacing: "0", fontWeight: "500" },
        ],
        "title-md": [
          "1rem",
          {
            lineHeight: "1.5rem",
            letterSpacing: "0.009em",
            fontWeight: "500",
          },
        ],
        "title-sm": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
            letterSpacing: "0.007em",
            fontWeight: "500",
          },
        ],
        "body-lg": [
          "1rem",
          {
            lineHeight: "1.5rem",
            letterSpacing: "0.009em",
            fontWeight: "400",
          },
        ],
        "body-md": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
            letterSpacing: "0.016em",
            fontWeight: "400",
          },
        ],
        "body-sm": [
          "0.75rem",
          {
            lineHeight: "1rem",
            letterSpacing: "0.025em",
            fontWeight: "400",
          },
        ],
        "label-lg": [
          "0.875rem",
          {
            lineHeight: "1.25rem",
            letterSpacing: "0.007em",
            fontWeight: "500",
          },
        ],
        "label-md": [
          "0.75rem",
          {
            lineHeight: "1rem",
            letterSpacing: "0.031em",
            fontWeight: "500",
          },
        ],
        "label-sm": [
          "0.6875rem",
          {
            lineHeight: "1rem",
            letterSpacing: "0.031em",
            fontWeight: "500",
          },
        ],
      },
    },
  },
  plugins: [],
};

export default config;
