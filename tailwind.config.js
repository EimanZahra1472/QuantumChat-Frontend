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
          cyan: '#06b6d4',
          bg: '#0f1115',
          surface: '#1a1d23',
          text: '#f1f5f9',
          textMuted: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};
