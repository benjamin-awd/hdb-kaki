// URA subzone → HDB town mapping, shared by the overview map (index) and Town Analysis.
// Subzones carry a planning `area` that mostly *is* the HDB town; the central and Kallang
// planning areas below roll up into their parent HDB town instead.
export const AREA_TO_TOWN: Record<string, string> = {
  KALLANG: 'KALLANG/WHAMPOA',
  'DOWNTOWN CORE': 'CENTRAL AREA',
  'MARINA EAST': 'CENTRAL AREA',
  'MARINA SOUTH': 'CENTRAL AREA',
  MUSEUM: 'CENTRAL AREA',
  NEWTON: 'CENTRAL AREA',
  ORCHARD: 'CENTRAL AREA',
  OUTRAM: 'CENTRAL AREA',
  'RIVER VALLEY': 'CENTRAL AREA',
  ROCHOR: 'CENTRAL AREA',
  'SINGAPORE RIVER': 'CENTRAL AREA',
  'STRAITS VIEW': 'CENTRAL AREA',
};

/**
 * Resolve a subzone's planning `area` to its HDB town: the area itself when it's a town that
 * has data, otherwise the central/Kallang roll-up. Returns undefined when it maps to neither.
 * Callers still validate the result against `townSet` (the roll-up target may lack data too).
 */
export function areaToTown(area: string, townSet: Set<string>): string | undefined {
  return townSet.has(area) ? area : AREA_TO_TOWN[area];
}
