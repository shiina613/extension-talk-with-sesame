/** Ensure AudioContext is running (required in offscreen / after user gesture). */
export async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}
