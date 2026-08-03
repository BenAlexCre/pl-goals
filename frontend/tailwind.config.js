/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#00e676',
          muted:   '#00c853',
          faint:   '#1b5e20',
        },
        'red-goal': '#ff5252',
        amber:      '#ffab00',
        pitch: {
          950: '#060a07',
          900: '#0a0e0d',
          800: '#0f1a12',
          700: '#152119',
          600: '#1a2820',
        },
        surface: {
          1: '#111a14',
          2: '#162019',
          3: '#1c2b21',
          4: '#223328',
        },
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.07)',
      },
      boxShadow: {
        glow: '0 0 24px rgba(0,230,118,0.15)',
        card: '0 2px 12px rgba(0,0,0,0.4)',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s ease-out',
        'slide-down': 'slideDown 0.25s ease-out',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' },                to: { opacity: '1' } },
        slideUp:   { from: { transform: 'translateY(12px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { from: { transform: 'translateY(-8px)', opacity: '0' }, to: { transform: 'translateY(0)',  opacity: '1' } },
      },
    },
  },
  plugins: [],
}