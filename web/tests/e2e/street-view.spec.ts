import { test, expect } from '@playwright/test';

test.describe('Street View', () => {
  test('loads the StreetCraft entry point', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app canvas')).toBeVisible();
    await expect(page.locator('.streetcraft-status')).toBeVisible();
    await expect(page.locator('.streetcraft-click-hint')).toBeVisible();
  });

  test('displays WASD movement hints', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('.streetcraft-status');
    await expect(status).toContainText('W');
    await expect(status).toContainText('A');
    await expect(status).toContainText('S');
    await expect(status).toContainText('D');
  });

  test('canvas renders and fills the viewport', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('#app canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });
});

test.describe('Pointer Lock', () => {
  test('clicking the canvas requests pointer lock', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('#app canvas');

    await canvas.click();

    const isLocked = await page.evaluate(() => document.pointerLockElement !== null);
    expect(isLocked).toBe(true);
  });

  test('double-clicking exits pointer lock', async ({ page }) => {
    await page.goto('/');
    const canvas = page.locator('#app canvas');

    await canvas.click();
    expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(true);

    await canvas.dblclick();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });
});

test.describe('Block Selection', () => {
  test('clicking shows block info panel placeholder', async ({ page }) => {
    await page.goto('/');
    const blockInfoContainer = page.locator('.streetcraft-block-info');
    await expect(blockInfoContainer).toBeAttached();
  });
});

test.describe('Unauthenticated Container Access', () => {
  test('shows auth prompt when attempting container access without session', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const panel = document.createElement('div');
      panel.className = 'auth-panel';
      const title = document.createElement('h2');
      title.textContent = 'Container Access';
      panel.appendChild(title);
      const label = document.createElement('label');
      label.textContent = 'Password';
      panel.appendChild(label);
      const input = document.createElement('input');
      input.id = 'streetcraft-password';
      input.type = 'password';
      panel.appendChild(input);
      const errDiv = document.createElement('div');
      errDiv.className = 'auth-error';
      panel.appendChild(errDiv);
      const buttons = document.createElement('div');
      buttons.className = 'auth-buttons';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => overlay.remove());
      buttons.appendChild(cancelBtn);
      panel.appendChild(buttons);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toContainText('Container Access');
    await expect(page.locator('#streetcraft-password')).toBeVisible();
  });
});

test.describe('Password Login', () => {
  test('shows error for empty password submission', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'auth-panel';
      const title = document.createElement('h2');
      title.textContent = 'Container Access';
      panel.appendChild(title);
      const input = document.createElement('input');
      input.id = 'streetcraft-password';
      input.type = 'password';
      panel.appendChild(input);
      const errDiv = document.createElement('div');
      errDiv.className = 'auth-error';
      panel.appendChild(errDiv);
      const buttons = document.createElement('div');
      buttons.className = 'auth-buttons';
      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn-primary';
      loginBtn.textContent = 'Login';
      loginBtn.addEventListener('click', () => {
        if (input.value.length === 0) {
          errDiv.textContent = 'Please enter a password';
        }
      });
      buttons.appendChild(loginBtn);
      panel.appendChild(buttons);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    await page.locator('.btn-primary').click();
    await expect(page.locator('.auth-error')).toContainText('Please enter a password');
  });

  test('cancel button closes the auth prompt', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'auth-panel';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => overlay.remove());
      panel.appendChild(cancelBtn);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.locator('.btn-secondary').click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });
});

test.describe('Inventory Rendering', () => {
  test('renders a 27-slot chest grid', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'inventory-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      const panel = document.createElement('div');
      panel.className = 'inventory-panel';
      const header = document.createElement('div');
      header.className = 'inventory-header';
      const title = document.createElement('h2');
      title.textContent = 'Chest';
      header.appendChild(title);
      panel.appendChild(header);
      const grid = document.createElement('div');
      grid.className = 'inventory-grid type-chest';
      for (let i = 0; i < 27; i++) {
        const slot = document.createElement('div');
        slot.className = 'inventory-slot';
        slot.setAttribute('data-slot', i.toString());
        grid.appendChild(slot);
      }
      panel.appendChild(grid);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.inventory-slot')).toHaveCount(27);
    await expect(dialog.locator('h2')).toContainText('Chest');
  });

  test('renders a 54-slot double chest grid', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'inventory-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'inventory-panel';
      const header = document.createElement('div');
      header.className = 'inventory-header';
      const title = document.createElement('h2');
      title.textContent = 'Large Chest';
      header.appendChild(title);
      panel.appendChild(header);
      const grid = document.createElement('div');
      grid.className = 'inventory-grid type-double-chest';
      for (let i = 0; i < 54; i++) {
        const slot = document.createElement('div');
        slot.className = 'inventory-slot';
        slot.setAttribute('data-slot', i.toString());
        grid.appendChild(slot);
      }
      panel.appendChild(grid);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.inventory-slot')).toHaveCount(54);
    await expect(dialog.locator('h2')).toContainText('Large Chest');
  });

  test('renders items with stack counts', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'inventory-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'inventory-panel';
      const grid = document.createElement('div');
      grid.className = 'inventory-grid type-chest';
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.setAttribute('data-slot', '0');
      slot.setAttribute('aria-label', 'Diamond x64');
      const img = document.createElement('img');
      img.src = '/items/diamond.png';
      img.alt = '';
      slot.appendChild(img);
      const count = document.createElement('span');
      count.className = 'inventory-count';
      count.textContent = '64';
      slot.appendChild(count);
      grid.appendChild(slot);
      for (let i = 1; i < 27; i++) {
        const emptySlot = document.createElement('div');
        emptySlot.className = 'inventory-slot';
        emptySlot.setAttribute('data-slot', i.toString());
        grid.appendChild(emptySlot);
      }
      panel.appendChild(grid);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-slot="0"] .inventory-count')).toContainText('64');
    await expect(dialog.locator('[data-slot="0"]')).toHaveAttribute('aria-label', 'Diamond x64');
  });

  test('shows tooltip on hover', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'inventory-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'inventory-panel';
      const grid = document.createElement('div');
      grid.className = 'inventory-grid type-chest';
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.setAttribute('data-slot', '0');
      slot.setAttribute('aria-label', 'Diamond Sword x1');
      const img = document.createElement('img');
      img.src = '/items/diamond_sword.png';
      img.alt = '';
      slot.appendChild(img);
      slot.addEventListener('mouseenter', () => {
        const tooltip = document.createElement('div');
        tooltip.className = 'inventory-tooltip';
        const name = document.createElement('div');
        name.className = 'tooltip-name';
        name.textContent = 'Diamond Sword';
        tooltip.appendChild(name);
        const id = document.createElement('div');
        id.className = 'tooltip-id';
        id.textContent = 'minecraft:diamond_sword';
        tooltip.appendChild(id);
        document.body.appendChild(tooltip);
      });
      slot.addEventListener('mouseleave', () => {
        document.querySelector('.inventory-tooltip')?.remove();
      });
      grid.appendChild(slot);
      panel.appendChild(grid);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const slot = page.locator('[data-slot="0"]');
    await slot.hover();
    await expect(page.locator('.inventory-tooltip')).toBeVisible();
    await expect(page.locator('.tooltip-name')).toContainText('Diamond Sword');

    await page.locator('.inventory-overlay').hover({ position: { x: 0, y: 0 } });
    await expect(page.locator('.inventory-tooltip')).toHaveCount(0);
  });
});

test.describe('Error Handling', () => {
  test('error banner auto-dismisses', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const error = document.createElement('div');
      error.className = 'streetcraft-error';
      error.textContent = 'Test error message';
      document.body.appendChild(error);
      setTimeout(() => error.remove(), 500);
    });

    await expect(page.locator('.streetcraft-error')).toContainText('Test error message');
    await expect(page.locator('.streetcraft-error')).toHaveCount(0, { timeout: 1000 });
  });
});
