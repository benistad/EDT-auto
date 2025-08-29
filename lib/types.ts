export type ClassLevel = "CP" | "CE1" | "CE2" | "CM1" | "CM2";
export type Cycle = "cycle2" | "cycle3";

export interface SchoolConfig {
  classLevel: ClassLevel;
  cycle: Cycle;
  schoolDays: string[]; // e.g., ["monday","tuesday",...]
  schoolHours: { start: string; end: string };
  breaks: {
    morning: { start: string; end: string };
    afternoon: { start: string; end: string };
  };
  lunchTime: { start: string; end: string };
}

export interface Subject {
  id: string;
  name: string;
  color: string;
  totalHours: number;
  remainingHours: number;
}

export interface TimeSlot {
  id: string;
  day: string; // localized day name (e.g., "Lundi")
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  subject?: Subject;
  subtitle?: string;
  duration: number; // minutes
}

// ===== Shared timetable types used by EDT Wizard =====
export type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

export interface DayConfig {
  key: DayKey;
  label: string;
  enabled: boolean;
  morningStart: string;
  lunchStart: string;
  lunchEnd: string;
  dayEnd: string;
  rec1Start: string;
  rec1Dur: number;
  rec2Start: string;
  rec2Dur: number;
}

export interface SubjectDef {
  key: string;
  label: string;
  minutes: number;
}

export interface Block {
  id: string;
  day: DayKey;
  subject: string;
  start: string;
  end: string;
  subtitle?: string;
}
