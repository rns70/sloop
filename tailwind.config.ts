import type { Config } from 'tailwindcss';

// Notion-style design tokens — the single source of truth for sloop's visual
// language (WP-4). Light, typographic, minimal: warm grays + one accent, hairline
// dividers, soft pastel role pills. WP-5 reuses these tokens via the design kit.
export default {
  content: ['./src/web/index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Text — warm grays.
        ink: {
          DEFAULT: '#37352f', // primary
          muted: '#787774', // secondary
          faint: '#9b9a97', // tertiary
          subtle: '#b4b3af', // faintest (placeholders, grips)
        },
        // Surfaces.
        paper: '#ffffff',
        sidebar: '#fbfbfa',
        active: '#f1f0ee', // selected sidebar row
        // Hairline dividers / borders.
        line: {
          DEFAULT: '#ededec',
          soft: '#f3f2f0',
          hair: '#f0efed',
        },
        // The single accent (blue).
        accent: {
          DEFAULT: '#2f5fb0',
          soft: '#eef3fb',
        },
        // Inline-diff treatment.
        diff: {
          addBg: '#eaf6ee',
          addText: '#2f6b45',
          addAccent: '#5aa978',
          delBg: '#fdecec',
          delText: '#9a4040',
          // Modified-line ("~") treatment — soft warm amber, tuned to the palette.
          changeBg: '#fbf3e2',
          changeText: '#8a6d1f',
          changeAccent: '#caa23f',
        },
        // Role pills — soft pastels (Engineer=blue, Architect=purple, QA=green, Security=pink).
        role: {
          blue: '#2f6cb0',
          blueBg: '#eaf2fb',
          purple: '#7c5cb8',
          purpleBg: '#f1ecfa',
          green: '#2f6b45',
          greenBg: '#eaf6ee',
          pink: '#b0467f',
          pinkBg: '#fbecf4',
          gray: '#615f5a',
          grayBg: '#f1f0ee',
          teal: '#2f8f80',
          tealBg: '#e6f4f1',
          amber: '#a8722f',
          amberBg: '#f7efe3',
        },
        // Status dots/labels.
        status: {
          running: '#2f5fb0',
          done: '#2f6b45',
          failed: '#c0392b',
          queued: '#b4b3af',
        },
      },
      maxWidth: {
        prose: '700px',
      },
      keyframes: {
        // A single soft light sweep for skeleton placeholders. Low-contrast so it reads
        // as "loading", not as decorative motion (Notion-quiet).
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
