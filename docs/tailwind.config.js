import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./build.mjs', './public/**/*.js', './dist/**/*.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Cloudflare orange
        brand: {
          50: '#fff6ed', 100: '#ffead4', 200: '#fdd0a8', 300: '#fcae71', 400: '#f98a3d',
          500: '#f6821f', 600: '#e76510', 700: '#bf4c10', 800: '#983c15', 900: '#7a3414',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [typography],
};
