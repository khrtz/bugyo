import { useState, type SubmitEvent } from 'react';
import { useDocumentTitle } from '@/shared/lib';
import { useAssetReviewQuery } from '../api/useAssetReviewQuery';
import { loadStore, saveStore, type Store } from '../api/storage';
import { Asset, findings, reviewStatus, summary, type Review } from '../model/asset-review';

const labels = { approved: '承認済み', changes: '差し戻し', issues: '要修正', ready: '確認待ち' };
type Filter = 'all' | keyof typeof labels;

function Workspace({ initial }: { initial: Asset[] }) {
  const [store, setStore] = useState(loadStore);
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [category, setCategory] = useState<Asset['category']>('Prop');
  const [triangles, setTriangles] = useState('');
  const [textureMb, setTextureMb] = useState('');
  const [message, setMessage] = useState('');
  const assets = [...initial, ...store.added];
  const counts = summary(assets, store.reviews);
  useDocumentTitle(`Asset Review · ${String(counts.total - counts.approved - counts.changes)} 件を確認`);
  const visible = assets.filter((asset) => filter === 'all' || reviewStatus(asset, store.reviews[asset.id]) === filter);
  const selected = assets.find((asset) => asset.id === selectedId);
  const problems = selected === undefined ? [] : findings(selected);

  function commit(next: Store) {
    saveStore(next);
    setStore(next);
  }

  function decide(decision: Review['decision']) {
    if (selected === undefined) return;
    if (decision === 'approved' && problems.length > 0) return;
    if (decision === 'changes' && note.trim() === '') {
      setMessage('差し戻し理由を入力してください。');
      return;
    }
    commit({ ...store, reviews: { ...store.reviews, [selected.id]: { decision, note: note.trim() } } });
    setMessage(`${selected.name} を${decision === 'approved' ? '承認し' : '差し戻し'}ました。`);
  }

  function add(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const asset: Asset = {
      id: crypto.randomUUID(), name: name.trim(), owner: owner.trim(), category,
      triangles: Number(triangles), textureMb: Number(textureMb),
    };
    commit({ ...store, added: [...store.added, asset] });
    setSelectedId(asset.id);
    setFilter('all');
    setName('');
    setOwner('');
    setTriangles('');
    setTextureMb('');
    setMessage(`${asset.name} を登録しました。`);
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">奉</span><span>BUGYO <small>LAB</small></span></div>
        <div className="side-label">WORKSPACE</div>
        <div className="side-current"><span className="side-icon">A</span><span>Asset Review<small>3D production</small></span></div>
        <div className="side-label side-section">COLLECTIONS</div>
        <nav aria-label="レビューの絞り込み">
          {([['all', 'すべて', counts.total], ['ready', '確認待ち', counts.total - counts.approved - counts.issues - counts.changes], ['issues', '要修正', counts.issues], ['approved', '承認済み', counts.approved], ['changes', '差し戻し', counts.changes]] as const).map(([key, label, count]) => (
            <button key={key} className={`nav-item ${filter === key ? 'active' : ''}`} type="button" aria-pressed={filter === key} onClick={() => { setFilter(key); }}>
              <span>{label}</span><span className="nav-count">{count}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><span className="online-dot" /> ローカルワークスペース<small>このブラウザにレビューを保存します</small></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div>PROJECT / <strong>Asset Review</strong></div><span className="topbar-right">PIPELINE TOOLS <span className="topbar-avatar">TA</span></span></header>
        <div className="content">
          <div className="heading-row"><div><div className="eyebrow">ASSET QUALITY CONTROL <span>／</span> 01</div><h1>アセットレビュー</h1><p>受け入れ基準のチェックから承認まで、ひとつの画面で。</p></div><span className="version">REVIEW DESK <b>v1.0</b></span></div>
          <div className="stats" aria-label="レビュー状況">
            <div className="stat"><span>登録アセット</span><strong>{counts.total.toString().padStart(2, '0')}</strong><small>ALL ASSETS</small></div>
            <div className="stat"><span>確認待ち・要修正</span><strong>{(counts.total - counts.approved - counts.changes).toString().padStart(2, '0')}</strong><small>NEEDS ATTENTION</small></div>
            <div className="stat"><span>承認済み</span><strong>{counts.approved.toString().padStart(2, '0')}</strong><small>APPROVED</small></div>
            <div className="stat"><span>差し戻し</span><strong>{counts.changes.toString().padStart(2, '0')}</strong><small>CHANGES REQUESTED</small></div>
          </div>
          <div className="section-head"><div><span className="section-index">01 /</span><h2>アセット一覧</h2><span className="section-meta">{visible.length} ITEMS</span></div><span className="threshold">基準値: 80,000 tris · 256 MB</span></div>
          <div className="review-grid">
            <div className="asset-list" aria-label="アセット一覧">
              <div className="list-columns"><span>ASSET / OWNER</span><span>STATUS</span></div>
              {visible.length === 0 && <p className="empty">この状態のアセットはありません。</p>}
              {visible.map((asset) => {
                const status = reviewStatus(asset, store.reviews[asset.id]);
                return <button type="button" key={asset.id} className={`asset-row ${selectedId === asset.id ? 'selected' : ''}`} onClick={() => { setSelectedId(asset.id); setNote(store.reviews[asset.id]?.note ?? ''); setMessage(''); }}>
                  <span className={`asset-glyph ${asset.category.toLowerCase()}`}>{asset.category.charAt(0)}</span>
                  <span className="asset-identity"><strong>{asset.name}</strong><small>{asset.owner} · {asset.category}</small></span>
                  <span className={`badge ${status}`}>{labels[status]}</span>
                </button>;
              })}
            </div>
            <section className="detail" aria-label="アセット詳細">
              {selected === undefined ? <p className="empty">アセットを選択してください。</p> : <>
                <div className="detail-top"><span>INSPECTION REPORT <b>#{selected.id.slice(0, 8).toUpperCase()}</b></span><span className={`badge ${reviewStatus(selected, store.reviews[selected.id])}`}>{labels[reviewStatus(selected, store.reviews[selected.id])]}</span></div>
                <div className="detail-icon">{selected.category.charAt(0)}</div>
                <h3>{selected.name}</h3><p className="detail-owner">{selected.owner} / {selected.category}</p>
                <div className="spec-grid"><div><span>TRIANGLES</span><strong>{selected.triangles.toLocaleString()}</strong></div><div><span>TEXTURE SIZE</span><strong>{selected.textureMb} <small>MB</small></strong></div></div>
                <div className="inspection"><div className="inspection-title">自動チェック <span>{problems.length === 0 ? 'ALL CLEAR' : `${String(problems.length)} ISSUES`}</span></div>
                  {problems.length === 0 ? <p className="clear">✓ すべての受け入れ基準を満たしています</p> : <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
                </div>
                <label className="note-label" htmlFor="review-note">レビューコメント</label>
                <textarea id="review-note" placeholder="差し戻し理由や引き継ぎ事項を入力" value={note} onChange={(event) => { setNote(event.target.value); }} />
                <div className="detail-actions"><button type="button" className="secondary" onClick={() => { decide('changes'); }}>差し戻す</button><button type="button" className="primary" disabled={problems.length > 0} onClick={() => { decide('approved'); }}>承認する <span>↗</span></button></div>
                {message && <p className="feedback" role="status">{message}</p>}
              </>}
            </section>
          </div>
          <div className="section-head add-head"><div><span className="section-index">02 /</span><h2>アセットを登録</h2></div><span className="section-meta">NEW SUBMISSION</span></div>
          <form className="add-form" onSubmit={add}>
            <label>ファイル名<input required value={name} onChange={(event) => { setName(event.target.value); }} placeholder="PROP_CHAIR_01.fbx" /></label>
            <label>担当者<input required value={owner} onChange={(event) => { setOwner(event.target.value); }} placeholder="Environment Art" /></label>
            <label>分類<select value={category} onChange={(event) => { const value = Asset.shape.category.safeParse(event.target.value); if (value.success) setCategory(value.data); }}><option>Prop</option><option>Character</option><option>Environment</option></select></label>
            <label>三角形数<input required min="0" step="1" type="number" value={triangles} onChange={(event) => { setTriangles(event.target.value); }} placeholder="24000" /></label>
            <label>テクスチャ MB<input required min="0" step="1" type="number" value={textureMb} onChange={(event) => { setTextureMb(event.target.value); }} placeholder="128" /></label>
            <button type="submit" className="add-button">+ 登録する</button>
          </form>
          <footer>BUGYO LAB <span>ASSET REVIEW / LOCAL WORKSPACE</span></footer>
        </div>
      </main>
    </div>
  );
}

export function AssetReviewView() {
  const query = useAssetReviewQuery();
  switch (query.status) {
    case 'loading': return <p role="status">アセットを読み込んでいます…</p>;
    case 'error': return <p role="alert">読み込みに失敗しました: {query.error.message}</p>;
    case 'ready': return <Workspace initial={query.data} />;
  }
}
