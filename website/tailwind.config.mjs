/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // 复用 Work Agents 应用主题色
        brand: {
          DEFAULT: '#2e6e44',
          light: '#3a8a58',
          dark: '#245636',
        },
        background: '#f8f8fa',
        foreground: '#26242a',
        muted: '#6b7280',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        'card': '0 0 0 1px rgba(38, 36, 42, 0.06), 0 1px 1px -0.5px rgba(0, 0, 0, 0.06), 0 3px 3px -1.5px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 0 0 1px rgba(38, 36, 42, 0.08), 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 6px 12px -2px rgba(0, 0, 0, 0.08)',
        'dropdown': '0 0 0 1px rgba(38, 36, 42, 0.06), 0 4px 6px -1px rgba(0, 0, 0, 0.06), 0 10px 20px -5px rgba(0, 0, 0, 0.08)',
      },
    },
  },
  plugins: [],
}
