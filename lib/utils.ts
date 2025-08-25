import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Format a duration in minutes as "XhYY" (e.g., 90 -> "1h30", 60 -> "1h")
export function minutesToHM(minutes: number): string {
  const total = Math.max(0, Math.round(minutes || 0))
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${h}h`
}
