/** @type {import('tailwindcss').Config} */

// Solid tokens expose RGB channels so opacity modifiers (e.g. `bg-accent-emphasis/40`) keep working.
const channel = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
// Muted tokens already carry their own alpha, so they resolve to a full color value.
const muted = (name) => `var(--color-${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: channel('canvas'),
          subtle: channel('canvas-subtle'),
          inset: channel('canvas-inset'),
        },
        line: {
          DEFAULT: channel('line'),
          muted: muted('line-muted'),
        },
        fg: {
          DEFAULT: channel('fg'),
          muted: channel('fg-muted'),
          onEmphasis: channel('fg-on-emphasis'),
        },
        accent: {
          fg: channel('accent-fg'),
          emphasis: channel('accent-emphasis'),
          muted: muted('accent-muted'),
        },
        success: {
          fg: channel('success-fg'),
          emphasis: channel('success-emphasis'),
          hover: channel('success-hover'),
          muted: muted('success-muted'),
        },
        danger: {
          fg: channel('danger-fg'),
          emphasis: channel('danger-emphasis'),
          muted: muted('danger-muted'),
        },
        attention: {
          fg: channel('attention-fg'),
          emphasis: channel('attention-emphasis'),
          muted: muted('attention-muted'),
        },
        done: {
          fg: channel('done-fg'),
          emphasis: channel('done-emphasis'),
          muted: muted('done-muted'),
        },
        control: {
          DEFAULT: channel('control'),
          hover: channel('control-hover'),
        },
        neutral: {
          muted: muted('neutral-muted'),
        },
      },
    },
  },
  plugins: [],
};
