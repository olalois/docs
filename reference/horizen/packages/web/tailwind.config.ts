import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0e0e0e",
          dim: "#0e0e0e",
          bright: "#2c2c2c",
          variant: "#252626",
          tint: "#c6c6c7",
          container: {
            DEFAULT: "#191a1a",
            low: "#131313",
            high: "#1f2020",
            highest: "#252626",
            lowest: "#000000",
          },
        },
        primary: {
          DEFAULT: "#c6c6c7",
          dim: "#b8b9b9",
          fixed: {
            DEFAULT: "#e2e2e2",
            dim: "#d4d4d4",
          },
          container: "#454747",
        },
        secondary: {
          DEFAULT: "#9c9e9c",
          dim: "#9c9e9c",
          fixed: {
            DEFAULT: "#e1e3e1",
            dim: "#d2d5d3",
          },
          container: "#393c3b",
        },
        error: {
          DEFAULT: "#ee7d77",
          dim: "#bb5551",
          container: "#7f2927",
        },
        outline: {
          DEFAULT: "#767575",
          variant: "#484848",
        },
        "on-surface": {
          DEFAULT: "#e7e5e4",
          variant: "#acabaa",
        },
        "on-primary": {
          DEFAULT: "#3f4041",
          container: "#d0d0d0",
          fixed: "#3e4040",
        },
        "on-secondary": {
          DEFAULT: "#1d2120",
          container: "#bdc0be",
        },
        "on-error": {
          DEFAULT: "#490106",
          container: "#ff9993",
        },
        "on-background": "#e7e5e4",
        "inverse-surface": "#fcf9f8",
        "inverse-on-surface": "#565555",
        "inverse-primary": "#5e5f60",
      },
      borderRadius: {
        DEFAULT: "0px",
        sm: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        full: "9999px",
      },
      fontFamily: {
        headline: ["'Space Grotesk'", "monospace"],
        label: ["'Space Grotesk'", "monospace"],
        body: ["'Inter'", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
