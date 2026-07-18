/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}",
    "./views/**/*.{ejs,html}"
  ],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            // Use system fonts instead of loading Google Fonts
            fontFamily: 'inherit',
            // Optional: Customize prose colors to match your design
            '--tw-prose-body': 'rgb(63 63 70)', // zinc-700
            '--tw-prose-headings': 'rgb(24 24 27)', // zinc-900
            '--tw-prose-links': 'rgb(220 38 38)', // red-600
            '--tw-prose-bold': 'rgb(24 24 27)',
            '--tw-prose-counters': 'rgb(113 113 122)',
            '--tw-prose-bullets': 'rgb(212 212 216)',
            maxWidth: 'none', // Since you use max-w-none
          }
        }
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}