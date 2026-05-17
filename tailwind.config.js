/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#FAFAFA',
          panel: '#FFFFFF',
          subtle: '#F4F4F5',
          muted: '#EFEFEF',
          hover: '#F0F0F2',
        },
        border: {
          DEFAULT: '#E5E5E5',
          subtle: '#EDEDED',
          strong: '#D4D4D4',
        },
        text: {
          primary: '#111111',
          secondary: '#3F3F46',
          muted: '#6B6B6B',
        },
        accent: {
          DEFAULT: '#2F6FEB',
          hover: '#1F5AD1',
          soft: 'rgba(47, 111, 235, 0.10)',
        },
        success: '#17A34A',
        warn: '#EAB308',
        danger: '#DC2626',
        diff: {
          addBg: 'rgba(23, 163, 74, 0.09)',
          addLine: 'rgba(23, 163, 74, 0.20)',
          delBg: 'rgba(220, 38, 38, 0.08)',
          delLine: 'rgba(220, 38, 38, 0.20)',
          focus: 'rgba(47, 111, 235, 0.08)',
          hunkBg: '#FAFAFA',
        },
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
        raised: '0 2px 8px rgba(17, 17, 17, 0.08)',
        card: '0 1px 2px rgba(17, 17, 17, 0.04)',
      },
      borderRadius: {
        card: '12px',
        pill: '999px',
      },
    },
  },
  plugins: [],
};
