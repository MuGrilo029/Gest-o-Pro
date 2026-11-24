/** @type {import('tailwindcss').Config} */

// Escala de cor da marca: os valores vêm de variáveis CSS (--brand-*), definidas em
// index.css (padrão) e trocadas por loja em runtime (lib/brand.ts). Os nomes `wine`
// (legado, usado em todo o app) e `primary` apontam para a mesma escala.
const brandScale = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(n => [n, `rgb(var(--brand-${n}) / <alpha-value>)`])
);

export default {
  darkMode: 'class',
  content: ['./index.html', './index.tsx', './App.tsx', './store.tsx', './components/**/*.{ts,tsx}', './pages/**/*.{ts,tsx}', './contexts/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      colors: {
        primary: brandScale,
        dark: {
          950: '#070a11',
          900: '#0b0f19',
          850: '#111827',
          800: '#182234',
          750: '#1e2c42',
          700: '#26354f',
        },
        wine: {
          ...brandScale,
          accent: '#991b1b',
          vibrant: '#881337',
          dark: '#4c0519',
        },
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        wine: '0 4px 20px -2px rgba(153, 27, 27, 0.4)',
        'wine-lg': '0 10px 30px -4px rgba(136, 19, 55, 0.5)',
      },
    },
  },
  plugins: [],
};
