/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
          panel: 'rgb(var(--color-bg-panel) / <alpha-value>)',
          subtle: 'rgb(var(--color-bg-subtle) / <alpha-value>)',
          muted: 'rgb(var(--color-bg-muted) / <alpha-value>)',
          hover: 'rgb(var(--color-bg-hover) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          subtle: 'rgb(var(--color-border-subtle) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-accent) / 0.10)',
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warn: 'rgb(var(--color-warn) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['14px', '20px'],
      },
      boxShadow: {
        raised: '0 2px 8px var(--shadow-raised)',
        card: '0 1px 2px var(--shadow-card)',
      },
      borderRadius: {
        card: '12px',
        pill: '999px',
      },
    },
  },
  plugins: [],
};
