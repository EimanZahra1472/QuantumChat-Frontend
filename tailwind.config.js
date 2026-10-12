/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  // Protect QuantumChat's design-system CSS from Tailwind Preflight resets
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          mauve: '#8a4a52',
          roseGold: '#e8b9ae',
          champagne: '#f6e6d8',
          bg: '#1a1214',
          surface: '#231819',
          text: '#f6e6d8',
          textMuted: '#b39a95',
        },
      },
    },
  },
  plugins: [],
};
