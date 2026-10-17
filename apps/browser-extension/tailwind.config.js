/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{tsx,ts,jsx,js,html}",
    "./components/**/*.{tsx,ts,jsx,js}",
    "./lib/**/*.{tsx,ts,jsx,js}",
    // Include workspace packages source files for direct source imports
    "../../packages/ui/src/**/*.{tsx,ts,jsx,js}",
    "../../packages/browser-runtime/src/**/*.{tsx,ts,jsx,js}",
  ],
  darkMode: "class",
  prefix: "",
  // Optimize for development
  safelist: [],
  future: {
    hoverOnlyWhenSupported: true,
  },
};
