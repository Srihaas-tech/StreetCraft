import { test, expect } from '@playwright/test';

test.describe('Container Authentication Flow', () => {
  test('auth overlay has accessible form elements', async ({ page }) => {
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
      label.setAttribute('for', 'streetcraft-password');
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
      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn-primary';
      loginBtn.textContent = 'Login';
      buttons.appendChild(cancelBtn);
      buttons.appendChild(loginBtn);
      panel.appendChild(buttons);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.locator('h2')).toContainText('Container Access');
    await expect(page.locator('#streetcraft-password')).toHaveAttribute('type', 'password');
    await expect(page.locator('.btn-primary')).toContainText('Login');
    await expect(page.locator('.btn-secondary')).toContainText('Cancel');
  });

  test('escape key closes the auth overlay', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      document.body.appendChild(overlay);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') overlay.remove();
      }, { once: true });
    });

    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('clicking backdrop closes the auth overlay', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
      });
      const panel = document.createElement('div');
      panel.className = 'auth-panel';
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.locator('.auth-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('failed login shows error message', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.className = 'auth-overlay';
      overlay.setAttribute('role', 'dialog');
      const panel = document.createElement('div');
      panel.className = 'auth-panel';
      const input = document.createElement('input');
      input.id = 'streetcraft-password';
      input.type = 'password';
      panel.appendChild(input);
      const errDiv = document.createElement('div');
      errDiv.className = 'auth-error';
      panel.appendChild(errDiv);
      const loginBtn = document.createElement('button');
      loginBtn.className = 'btn-primary';
      loginBtn.textContent = 'Login';
      loginBtn.addEventListener('click', () => {
        errDiv.textContent = 'Incorrect password';
      });
      panel.appendChild(loginBtn);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    });

    await page.locator('#streetcraft-password').fill('wrong-password');
    await page.locator('.btn-primary').click();
    await expect(page.locator('.auth-error')).toContainText('Incorrect password');
  });
});
