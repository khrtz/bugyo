// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetReviewView } from '../src/features/asset-review';

vi.mock('../src/features/asset-review/api/useAssetReviewQuery', () => ({
  useAssetReviewQuery: () => ({ status: 'ready', data: [
    { id: 'hero', name: 'CHR_HERO_A.fbx', category: 'Character', triangles: 62400, textureMb: 192, owner: 'Art' },
    { id: 'npc', name: 'chr_npc draft.fbx', category: 'Character', triangles: 112500, textureMb: 384, owner: 'Outsource' },
  ] }),
}));

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

it('基準を検査し、承認・登録・差し戻しを保存して復元する', async () => {
  const user = userEvent.setup();
  const view = render(<AssetReviewView />);
  const detail = within(screen.getByRole('region', { name: 'アセット詳細' }));
  await user.click(screen.getByRole('button', { name: /承認する/ }));
  expect(detail.getByText('承認済み')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /chr_npc draft.fbx/ }));
  expect(detail.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('button', { name: /承認する/ }).hasAttribute('disabled')).toBe(true);

  await user.type(screen.getByRole('textbox', { name: 'ファイル名' }), 'PROP_NEW_01.fbx');
  await user.type(screen.getByRole('textbox', { name: '担当者' }), 'TA');
  await user.type(screen.getByRole('spinbutton', { name: '三角形数' }), '80001');
  await user.type(screen.getByRole('spinbutton', { name: 'テクスチャ MB' }), '257');
  await user.click(screen.getByRole('button', { name: /登録する/ }));
  expect(detail.getAllByRole('listitem')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: '差し戻す' }));
  expect(screen.getByRole('status').textContent).toContain('差し戻し理由');
  await user.type(screen.getByRole('textbox', { name: 'レビューコメント' }), '容量を削減');
  await user.click(screen.getByRole('button', { name: '差し戻す' }));

  view.unmount();
  render(<AssetReviewView />);
  await user.click(screen.getByRole('button', { name: /PROP_NEW_01.fbx/ }));
  expect(within(screen.getByRole('region', { name: 'アセット詳細' })).getByText('差し戻し')).toBeTruthy();
  const comment = screen.getByRole('textbox', { name: 'レビューコメント' });
  expect(comment instanceof HTMLTextAreaElement && comment.value).toBe('容量を削減');
  await user.click(within(screen.getByRole('navigation', { name: 'レビューの絞り込み' })).getByRole('button', { name: /承認済み/ }));
  expect(within(screen.getByLabelText('アセット一覧')).getAllByRole('button')).toHaveLength(1);
});
