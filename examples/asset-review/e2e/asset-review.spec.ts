import { expect, test } from '@playwright/test';

test('自動チェック、承認、絞り込み、再読み込み後の復元', async ({ page }) => {
  await page.goto('/');
  const list = page.getByLabel('アセット一覧');
  await expect(list.getByRole('button')).toHaveCount(4);
  await expect(page.getByLabel('アセット詳細').getByText('すべての受け入れ基準を満たしています')).toBeVisible();
  await page.getByRole('button', { name: /承認する/ }).click();
  await expect(page.getByRole('status').getByText('CHR_HERO_A.fbx を承認しました。')).toBeVisible();
  await page.getByRole('navigation', { name: 'レビューの絞り込み' }).getByRole('button', { name: '承認済み' }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('アセット詳細').getByText('承認済み')).toBeVisible();
  await list.getByRole('button', { name: /chr_npc draft/ }).click();
  await expect(page.getByLabel('アセット詳細').getByRole('listitem')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /承認する/ })).toBeDisabled();
});

test('登録したアセットを差し戻し、理由を保存する', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'ファイル名' }).fill('PROP_TEST_01.fbx');
  await page.getByRole('textbox', { name: '担当者' }).fill('TA');
  await page.getByRole('spinbutton', { name: '三角形数' }).fill('80001');
  await page.getByRole('spinbutton', { name: 'テクスチャ MB' }).fill('257');
  await page.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByLabel('アセット詳細').getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: '差し戻す' }).click();
  await expect(page.getByRole('status').getByText('差し戻し理由を入力してください。')).toBeVisible();
  await page.getByRole('textbox', { name: 'レビューコメント' }).fill('ポリゴン数とテクスチャを削減してください');
  await page.getByRole('button', { name: '差し戻す' }).click();
  await page.reload();
  await expect(page.getByLabel('アセット一覧').getByRole('button', { name: /PROP_TEST_01/ })).toBeVisible();
  await page.getByLabel('アセット一覧').getByRole('button', { name: /PROP_TEST_01/ }).click();
  await expect(page.getByLabel('アセット詳細').getByText('差し戻し')).toBeVisible();
});
