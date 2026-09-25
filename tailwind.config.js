/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#0d1117',
          subtle: '#151b23',
          inset: '#010409',
        },
        line: {
          DEFAULT: '#3d444d',
          muted: '#3d444db3',
        },
        fg: {
          DEFAULT: '#f0f6fc',
          muted: '#9198a1',
          onEmphasis: '#ffffff',
        },
        accent: {
          fg: '#4493f8',
          emphasis: '#1f6feb',
          muted: '#388bfd1a',
        },
        success: {
          fg: '#3fb950',
          emphasis: '#238636',
          hover: '#29903b',
          muted: '#2ea04326',
        },
        danger: {
          fg: '#f85149',
          emphasis: '#da3633',
          muted: '#f851491a',
        },
        attention: {
          fg: '#d29922',
          emphasis: '#9e6a03',
          muted: '#bb800926',
        },
        done: {
          fg: '#ab7df8',
          emphasis: '#8957e5',
          muted: '#ab7df826',
        },
        control: {
          DEFAULT: '#212830',
          hover: '#262c36',
        },
        neutral: {
          muted: '#656c7633',
        },
      },
    },
  },
  plugins: [],
};
