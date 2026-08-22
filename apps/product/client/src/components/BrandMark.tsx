/** Signal Cabinet style reminder: the mark is a small, exact piece of industrial evidence. */
type BrandMarkProps = { compact?: boolean };

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div className={compact ? "brand-mark brand-mark--compact" : "brand-mark"} aria-label="Threshold">
      <img src="/manus-storage/threshold-gate-mark_98978d28.png" alt="" />
      {!compact && <span>THRESHOLD</span>}
    </div>
  );
}
