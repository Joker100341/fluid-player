import { test, expect } from '@playwright/test';

/**
 * Regression test for the skip-forward / skip-backward animation icons
 * getting stuck visible when arrow keys are mashed during video buffering.
 *
 * Root cause: skipRelative() adds the `.animate` class and relies on a
 * transitionend event to remove it. Under main-thread pressure (rapid
 * seeking that forces buffering), the browser can drop transition events
 * and the class never gets removed, leaving the +10s / -10s icon
 * permanently visible on the player.
 */
test.describe('skip animation icons', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/skip_return.html');
        // Click the player to start playback AND install the document-level
        // keyboard handler (captureKey is bound on first wrapper click).
        await page.locator('#fluid_video_wrapper_fluid-player-e2e-case').click();
        await page.waitForFunction(() => {
            const v = document.querySelector('video');
            return v && !v.paused && v.readyState >= 2;
        });
    });

    test('icons do not get stuck when alternating arrow keys rapidly', async ({ page }) => {
        // Seek near the end so each skip bounces around an unbuffered region,
        // creating the main-thread pressure that surfaces the bug.
        await page.evaluate(() => {
            const v = document.querySelector('video')!;
            v.currentTime = Math.max(0, (v.duration || 60) - 30);
        });

        // Try the alternation pattern multiple times; the bug is racy so a
        // single burst may not trigger pre-fix. After the fix, no burst
        // should ever leave the class stuck.
        for (let attempt = 0; attempt < 5; attempt++) {
            for (let i = 0; i < 40; i++) {
                await page.keyboard.press(i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft');
            }

            // Give transitions time to settle: 150ms fade-in + 400ms fade-out + slack.
            await page.waitForTimeout(1200);

            const stuck = await page.evaluate(() => {
                const f = document.querySelector('.fluid_player_skip_offset__forward-icon')!;
                const b = document.querySelector('.fluid_player_skip_offset__backward-icon')!;
                return {
                    fwd:  { anim: f.classList.contains('animate'), op: getComputedStyle(f).opacity },
                    back: { anim: b.classList.contains('animate'), op: getComputedStyle(b).opacity },
                };
            });

            expect(stuck.fwd.anim,  `attempt ${attempt}: forward icon stuck`).toBe(false);
            expect(stuck.back.anim, `attempt ${attempt}: backward icon stuck`).toBe(false);
        }
    });
});
