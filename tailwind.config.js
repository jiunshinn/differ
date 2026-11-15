/** @type {import('tailwindcss').Config} */
// Colours, fonts and motion come from src/styles/tokens.css.
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: rgb('color-bg'),
          panel: rgb('color-bg-panel'),
          raised: rgb('color-bg-raised'),
          subtle: rgb('color-bg-subtle'),
          muted: rgb('color-bg-muted'),
          hover: rgb('color-bg-hover'),
        },
        border: {
          DEFAULT: rgb('color-border'),
          subtle: rgb('color-border-subtle'),
          strong: rgb('color-border-strong'),
        },
        text: {
          primary: rgb('color-text-primary'),
          secondary: rgb('color-text-secondary'),
          muted: rgb('color-text-muted'),
          faint: rgb('color-text-faint'),
        },
        accent: {
          DEFAULT: rgb('color-accent'),
          hover: rgb('color-accent-hover'),
          soft: 'rgb(var(--color-accent) / 0.12)',
        },
        'on-accent': rgb('color-on-accent'),
        success: rgb('color-success'),
        warn: rgb('color-warn'),
        danger: rgb('color-danger'),
        info: rgb('color-info'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      // [size, { lineHeight, letterSpacing }]: body text is 13.5px.
      fontSize: {
        '2xs': ['10.5px', { lineHeight: '14px' }],
        xs: ['11.5px', { lineHeight: '16px' }],
        sm: ['12.5px', { lineHeight: '18px' }],
        base: ['13.5px', { lineHeight: '20px' }],
        md: ['14px', { lineHeight: '22px' }],
        lg: ['15px', { lineHeight: '22px', letterSpacing: '-0.01em' }],
        xl: ['17px', { lineHeight: '24px', letterSpacing: '-0.015em' }],
        '2xl': ['20px', { lineHeight: '28px', letterSpacing: '-0.02em' }],
        '3xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.03em' }],
      },
      boxShadow: {
        card: '0 1px 2px var(--shadow-card)',
        raised: '0 2px 8px var(--shadow-raised)',
        popover: 'var(--shadow-popover)',
        float: 'var(--shadow-float)',
      },
      opacity: { 12: '0.12', 35: '0.35', 45: '0.45' },
      borderRadius: {
        card: '12px',
        pill: '999px',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      keyframes: {
        pulse: { '50%': { opacity: '0.35' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'status-pulse': 'pulse 1.6s ease-in-out infinite',
        'fade-in': 'fade-in var(--duration-fast) var(--ease-out)',
        'pop-in': 'pop-in var(--duration-fast) var(--ease-out)',
      },
    },
  },
  plugins: [],
};
