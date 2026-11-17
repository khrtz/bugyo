import { expect, test } from '@playwright/test';

test('一覧を表示し、トグルと絞り込みができる', async ({ page }) => {
  await page.goto('/');
  const todos = page.getByRole('region', { name: 'Todo' });
  await expect(todos.getByText('残り 2 件')).toBeVisible();
  await expect(todos).toHaveScreenshot('todos-initial.png');

  await todos.getByLabel('境界lintを入れる').check();
  await expect(todos.getByText('残り 1 件')).toBeVisible();
  await expect(page).toHaveTitle('残り 1 件');

  await todos.getByRole('button', { name: '未完了' }).click();
  await expect(todos.getByRole('listitem')).toHaveCount(1);
  await expect(todos.getByLabel('pnpm verify で証拠を残す')).toBeVisible();

  await todos.getByRole('button', { name: '完了', exact: true }).click();
  await expect(todos.getByRole('listitem')).toHaveCount(2);
});
