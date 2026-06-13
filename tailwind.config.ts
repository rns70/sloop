import type { Config } from 'tailwindcss';

// Notion-style: light, typographic, minimal. Tokens kept intentionally small;
// WP-4 owns the real design system under src/web/design/.
export default {
  content: ['./src/web/index.html', './src/web/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          DEFAULT: '#37352f',
          muted: '#787774',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
