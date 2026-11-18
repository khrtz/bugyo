import { expect, test } from '@playwright/test';

test('shows the list, toggles a todo, and filters', async ({ page }) => {
  await page.goto('/');
  const todos = page.getByRole('region', { name: 'Todo' });
  await expect(todos.getByText('2 left')).toBeVisible();
  await expect(todos).toHaveScreenshot('todos-initial.png');

  await todos.getByLabel('Add the boundary lint').check();
  await expect(todos.getByText('1 left')).toBeVisible();
  await expect(page).toHaveTitle('1 left');

  await todos.getByRole('button', { name: 'Active' }).click();
  await expect(todos.getByRole('listitem')).toHaveCount(1);
  await expect(todos.getByLabel('Keep evidence with pnpm verify')).toBeVisible();

  await todos.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(todos.getByRole('listitem')).toHaveCount(2);
});
