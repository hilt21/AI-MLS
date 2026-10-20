'use client';
import { useRef, useState } from 'react';

export type Crop = { left: number; top: number; right: number; bottom: number };
const full: Crop = { left: 0, top: 0, right: 100, bottom: 100 };

/** Coordinates are percentages of the displayed image, independent of screen size. */
export function PhotoCrop({ src, initialCrop, busy, onApply, onCancel }: {
  src: string; initialCrop?: Crop; busy: boolean; onApply: (crop: Crop) => void; onCancel: () => void;
}) {
  const [crop, setCrop] = useState<Crop>(initialCrop??full);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; previous: Crop } | null>(null);
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (e.clientX - box.left) / box.width * 100)),
      y: Math.max(0, Math.min(100, (e.clientY - box.top) / box.height * 100)) };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== e.pointerId) return;
    const p = point(e);
    setCrop({ left: Math.min(start.x, p.x), right: Math.max(start.x, p.x),
      top: Math.min(start.y, p.y), bottom: Math.max(start.y, p.y) });
  }
  const valid = crop.right - crop.left >= 1 && crop.bottom - crop.top >= 1;
  return <div className="photo-crop">
    <h3>裁剪题目照片</h3>
    <p className="hint">在图片上拖出要保留的区域，或用下方滑块微调四边。框外内容不会上传。</p>
    <div className="crop-surface" data-testid="crop-surface"
      onPointerDown={e => {
        if (busy || !loaded || failed || drag.current || !e.isPrimary || e.button !== 0) return;
        const p = point(e); drag.current = { id: e.pointerId, ...p, previous: crop };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={e => {
        const start = drag.current;
        if (!start || start.id !== e.pointerId) return;
        const p = point(e);
        if (Math.abs(p.x - start.x) < 1 || Math.abs(p.y - start.y) < 1) setCrop(start.previous);
        else move(e);
        drag.current = null;
      }}
      onPointerCancel={() => { if (drag.current) setCrop(drag.current.previous); drag.current = null; }}>
      <img src={src} alt="待裁剪的题目照片" draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>
      <div className="crop-selection" aria-hidden="true" style={{ left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.right - crop.left}%`, height: `${crop.bottom - crop.top}%` }}/>
    </div>
    {failed && <p role="alert">无法读取图片，请取消裁剪并重新选择 JPG、PNG 或 WebP 图片。</p>}
    <fieldset disabled={busy} className="crop-controls"><legend>调整保留区域</legend>
      {(['left', 'right', 'top', 'bottom'] as const).map(edge => <label key={edge}>
        {{ left: '左边界', right: '右边界', top: '上边界', bottom: '下边界' }[edge]}
        <input type="range" min={edge === 'right' ? crop.left + 1 : edge === 'bottom' ? crop.top + 1 : 0}
          max={edge === 'left' ? crop.right - 1 : edge === 'top' ? crop.bottom - 1 : 100} step="1" value={crop[edge]}
          onChange={e => setCrop(c => ({ ...c, [edge]: Number(e.target.value) }))}/>
      </label>)}
    </fieldset>
    <div className="button-row">
      <button className="button secondary" disabled={busy} onClick={() => setCrop(full)}>重置裁剪</button>
      <button className="button secondary" disabled={busy} onClick={onCancel}>取消裁剪</button>
      <button className="button primary" disabled={busy || !valid || !loaded || failed} onClick={() => onApply(crop)}>{busy ? '正在裁剪…' : '应用裁剪'}</button>
    </div>
  </div>;
}
