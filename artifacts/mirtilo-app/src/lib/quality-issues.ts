export const QUALITY_ISSUES = ["CALIBRE", "PENDUNCULOS", "VERDE", "MOLE", "OUTROS"] as const;

export type QualityIssue = (typeof QUALITY_ISSUES)[number];

export const QUALITY_LABELS: Record<QualityIssue, string> = {
  CALIBRE: "Calibre",
  PENDUNCULOS: "Pendúculos",
  VERDE: "Verde",
  MOLE: "Mole",
  OUTROS: "Outros",
};

export const QUALITY_SHORT: Record<QualityIssue, string> = {
  CALIBRE: "C",
  PENDUNCULOS: "P",
  VERDE: "V",
  MOLE: "M",
  OUTROS: "O",
};

export const QUALITY_CHIP_CLASS: Record<QualityIssue, string> = {
  CALIBRE: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-700",
  PENDUNCULOS: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700",
  VERDE: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700",
  MOLE: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700",
  OUTROS: "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
};

export function isQualityIssue(value: string): value is QualityIssue {
  return (QUALITY_ISSUES as readonly string[]).includes(value);
}
