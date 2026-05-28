/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#0a0a0a',
        'dark-panel': '#111111',
        'neon-pink': '#ff00ff',
        'neon-cyan': '#00ffff',
        'neon-green': '#00ff00',
        'gold': '#ffd700',
        'dark-gold': '#b8860b',
      },
      boxShadow: {
        'neon-pink': '0 0 5px #ff00ff, 0 0 10px #ff00ff, 0 0 20px #ff00ff',
        'neon-cyan': '0 0 5px #00ffff, 0 0 10px #00ffff, 0 0 20px #00ffff',
        'neon-green': '0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 20px #00ff00',
      }
    },
  },
  plugins: [],
}