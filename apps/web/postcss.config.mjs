/**
 * Intentionally empty.
 *
 * Next resolves PostCSS config by walking UP the directory tree. The repo sits
 * under C:\Users\USER\Desktop, which has its own stray postcss.config.mjs from
 * an unrelated project; without this file Next picks that one up and fails
 * trying to load a Tailwind plugin this workspace does not install.
 *
 * Declaring an empty plugin set here stops the upward search at the app root.
 * Add real plugins here if the dashboard needs them in Phase 5.
 */

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {},
};

export default config;
