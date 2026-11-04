/**
 * Kategorie-Farben, nach Farbton sortiert. Per Maximin-Auswahl nach CIEDE2000 bestimmt:
 * Kein Paar liegt naeher als 15,4. Sehr dunkle und sehr helle Toene sind ausgespart.
 */
export const CATEGORY_COLORS: readonly { hex: string; name: string }[] = [
  { hex: '#cc0000', name: 'Rot' },
  { hex: '#cc0066', name: 'Himbeere' },
  { hex: '#ff9999', name: 'Lachsrosa' },
  { hex: '#996666', name: 'Altrosa' },
  { hex: '#663333', name: 'Kastanie' },
  { hex: '#ff6600', name: 'Orange' },
  { hex: '#ffcc99', name: 'Apricot' },
  { hex: '#663300', name: 'Braun' },
  { hex: '#996600', name: 'Ocker' },
  { hex: '#cc9900', name: 'Gold' },
  { hex: '#cccc00', name: 'Senfgelb' },
  { hex: '#cccc99', name: 'Sand' },
  { hex: '#666600', name: 'Oliv' },
  { hex: '#00ff00', name: 'Leuchtgrün' },
  { hex: '#669966', name: 'Salbei' },
  { hex: '#006600', name: 'Tannengrün' },
  { hex: '#00cc99', name: 'Mint' },
  { hex: '#009999', name: 'Türkis' },
  { hex: '#006666', name: 'Petrol' },
  { hex: '#00ffff', name: 'Cyan' },
  { hex: '#99cccc', name: 'Eisblau' },
  { hex: '#0099cc', name: 'Himmelblau' },
  { hex: '#006699', name: 'Stahlblau' },
  { hex: '#003399', name: 'Königsblau' },
  { hex: '#6666ff', name: 'Kornblume' },
  { hex: '#666699', name: 'Schiefer' },
  { hex: '#ccccff', name: 'Lavendel' },
  { hex: '#660099', name: 'Dunkelviolett' },
  { hex: '#cc33cc', name: 'Magenta' },
  { hex: '#ff99ff', name: 'Orchidee' },
  { hex: '#999999', name: 'Grau' },
  { hex: '#666666', name: 'Dunkelgrau' },
];

export function colorName(hex: string | null | undefined): string | null {
  return CATEGORY_COLORS.find((c) => c.hex === hex)?.name ?? null;
}
