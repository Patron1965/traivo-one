export function formatPrice(oreValue: number | undefined | null): string {
  if (oreValue == null || isNaN(oreValue)) return '–';
  const kronor = oreValue / 100;
  return `${kronor.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}

export function formatDuration(minutes: number | undefined | null): string {
  if (minutes == null || minutes <= 0) return 'Ej angiven';
  return `${minutes} min`;
}
