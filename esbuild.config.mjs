/**
 * esbuild configuration for Chrome Extension (Manifest V3).
 *
 * Produces separate bundles for each entry point:
 * - service-worker.js  (background script)
 * - offscreen.js       (offscreen document)
 * - popup.js           (popup UI)
 * - audio-processor.worklet.js (AudioWorklet, no bundling of external deps)
 *
 * Output goes to dist/ with manifest.json and static assets copied.
 */

import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const isWatch = process.argv.includes('--watch');
const outdir = 'dist';

// Ensure output directory exists
mkdirSync(outdir, { recursive: true });

/** Shared esbuild options for all entry points */
const sharedOptions = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  outdir,
  alias: {
    '@modules': './src/modules',
    '@shared': './src/shared',
  },
};

/** Main entry points (service-worker, offscreen, popup) */
const mainBuildOptions = {
  ...sharedOptions,
  entryPoints: [
    { in: 'src/modules/service-worker/service-worker.ts', out: 'service-worker' },
    { in: 'src/modules/offscreen/offscreen.ts', out: 'offscreen' },
    { in: 'src/modules/chat-ui/popup.ts', out: 'popup' },
  ],
};

/**
 * AudioWorklet entry point — bundled separately.
 * AudioWorklet runs in its own scope and cannot use ES module imports at runtime,
 * so we bundle it as an IIFE.
 */
const workletBuildOptions = {
  ...sharedOptions,
  format: 'iife',
  entryPoints: [
    { in: 'src/modules/audio-processor/audio-processor.worklet.ts', out: 'audio-processor.worklet' },
  ],
};

/** Copy static assets to dist/ */
function copyStaticAssets() {
  // manifest.json
  cpSync('src/manifest.json', path.join(outdir, 'manifest.json'));

  // Offscreen HTML
  cpSync(
    'src/modules/offscreen/offscreen.html',
    path.join(outdir, 'offscreen.html'),
  );

  // Popup HTML + CSS
  cpSync('src/modules/chat-ui/popup.html', path.join(outdir, 'popup.html'));
  cpSync('src/modules/chat-ui/popup.css', path.join(outdir, 'popup.css'));

  // Icons directory (if exists)
  if (existsSync('src/icons')) {
    cpSync('src/icons', path.join(outdir, 'icons'), { recursive: true });
  }
}

async function build() {
  try {
    if (isWatch) {
      const mainCtx = await esbuild.context(mainBuildOptions);
      const workletCtx = await esbuild.context(workletBuildOptions);
      await mainCtx.watch();
      await workletCtx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(mainBuildOptions);
      await esbuild.build(workletBuildOptions);
    }

    copyStaticAssets();
    console.log('Build complete → dist/');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
