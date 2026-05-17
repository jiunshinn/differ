/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0f1115',
          panel: '#151821',
          subtle: '#1b1f2a',
          muted: '#222735',
          hover: '#262b3a',
        },
        border: {
          DEFAULT: '#2a3040',
          subtle: '#1f2431',
        },
        text: {
          primary: '#e6e9ef',
          secondary: '#9aa3b2',
          muted: '#6b7280',
        },
        accent: {
          DEFAULT: '#5b8def',
          hover: '#4a7adf',
        },
        success: '#10b981',
        warn: '#f59e0b',
        danger: '#ef4444',
        diff: {
          addBg: 'rgba(16, 185, 129, 0.12)',
          addLine: 'rgba(16, 185, 129, 0.25)',
          delBg: 'rgba(239, 68, 68, 0.10)',
          delLine: 'rgba(239, 68, 68, 0.22)',
          hunkBg: '#1a1f2c',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['13px', '20px'],
      },
    },
  },
  plugins: [],
};
