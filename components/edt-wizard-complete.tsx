"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import type { DragEvent, ReactElement } from "react"
import { Rnd } from "react-rnd"
import { jsPDF } from "jspdf"
import { sanitizeOklchInClone, rasterizeWithFallback } from "@/lib/pdf-utils"
import { minutesToHM } from "@/lib/utils"

// Emploi du temps – Assistant CP→CM2 (Wizard + Drag & Drop + Export PDF)
// Single-file React component with Tailwind CSS

// ===== Types de domaine =====
type Cycle = 'C2' | 'C3'
type Klass = 'CP' | 'CE1' | 'CE2' | 'CM1' | 'CM2'
type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'
type SubjectKey = 'fr' | 'maths' | 'lv' | 'eps' | 'arts' | 'qlm_emc' | 'sciences' | 'hg_emc'
type Subject = { key: SubjectKey; label: string; minutes: number }
type Day = {
  key: DayKey; label: string; enabled: boolean;
  morningStart: string; lunchStart: string; lunchEnd: string; dayEnd: string;
  rec1Start: string; rec1Dur: number; rec2Start: string; rec2Dur: number;
}
type Block = { id: string; day: DayKey; subject: SubjectKey; start: string; end: string; subtitle?: string }
type NewBlock = Omit<Block, 'id'>
type TimePart = 'AM' | 'PM'

// Helpers d'export centralisés: importés depuis '@/lib/pdf-utils'

// ===== Utilitaires temps (HH:MM) + mini tests =====
function toMin(hhmm: string): number {
  if (!hhmm || typeof hhmm !== "string") return 0;
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function toHHMM(m: number): string {
  const total = Math.max(0, Math.round(m));
  const h = Math.floor(total / 60);
  const mm = (total % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}
function clamp(min: number, val: number, max: number): number { return Math.max(min, Math.min(max, val)); }

// ===== Volumes hebdo SANS récré (d'après doc C2/C3) =====
const SUBJECTS: Record<Cycle, Subject[]> = {
  C2: [
    { key: "fr", label: "Français", minutes: 9 * 60 + 10 },
    { key: "maths", label: "Mathématiques", minutes: 4 * 60 + 35 },
    { key: "lv", label: "Langues vivantes", minutes: 1 * 60 + 20 },
    { key: "eps", label: "EPS", minutes: 2 * 60 + 45 },
    { key: "arts", label: "Arts", minutes: 1 * 60 + 50 },
    { key: "qlm_emc", label: "QLM + EMC", minutes: 2 * 60 + 20 },
  ],
  C3: [
    { key: "fr", label: "Français", minutes: 7 * 60 + 20 },
    { key: "maths", label: "Mathématiques", minutes: 4 * 60 + 35 },
    { key: "lv", label: "Langues vivantes", minutes: 1 * 60 + 20 },
    { key: "eps", label: "EPS", minutes: 2 * 60 + 45 },
    { key: "sciences", label: "Sciences & techno", minutes: 1 * 60 + 50 },
    { key: "arts", label: "Arts", minutes: 1 * 60 + 50 },
    { key: "hg_emc", label: "Histoire-Géo + EMC", minutes: 2 * 60 + 20 },
  ],
};

const SUBJECT_COLORS: Record<SubjectKey | 'autre', string> = {
  fr: "bg-indigo-100 border-indigo-300",
  maths: "bg-rose-100 border-rose-300",
  lv: "bg-amber-100 border-amber-300",
  eps: "bg-emerald-100 border-emerald-300",
  arts: "bg-pink-100 border-pink-300",
  qlm_emc: "bg-sky-100 border-sky-300",
  sciences: "bg-teal-100 border-teal-300",
  hg_emc: "bg-cyan-100 border-cyan-300",
  autre: "bg-gray-100 border-gray-300",
};

const CLASS_TO_CYCLE: Record<Klass, Cycle> = { CP: "C2", CE1: "C2", CE2: "C2", CM1: "C3", CM2: "C3" };

const DEFAULT_DAYS: Day[] = [
  { key: "Mon", label: "Lundi", enabled: true,  morningStart: "08:30", lunchStart: "12:00", lunchEnd: "13:30", dayEnd: "16:30", rec1Start: "10:15", rec1Dur: 15, rec2Start: "15:00", rec2Dur: 15 },
  { key: "Tue", label: "Mardi", enabled: true,  morningStart: "08:30", lunchStart: "12:00", lunchEnd: "13:30", dayEnd: "16:30", rec1Start: "10:15", rec1Dur: 15, rec2Start: "15:00", rec2Dur: 15 },
  { key: "Wed", label: "Mercredi", enabled: false, morningStart: "08:30", lunchStart: "12:00", lunchEnd: "13:30", dayEnd: "16:30", rec1Start: "10:15", rec1Dur: 15, rec2Start: "15:00", rec2Dur: 15 },
  { key: "Thu", label: "Jeudi", enabled: true,  morningStart: "08:30", lunchStart: "12:00", lunchEnd: "13:30", dayEnd: "16:30", rec1Start: "10:15", rec1Dur: 15, rec2Start: "15:00", rec2Dur: 15 },
  { key: "Fri", label: "Vendredi", enabled: true,  morningStart: "08:30", lunchStart: "12:00", lunchEnd: "13:30", dayEnd: "16:30", rec1Start: "10:15", rec1Dur: 15, rec2Start: "15:00", rec2Dur: 15 },
];

const PX_PER_MIN = 1; // 1px = 1 minute pour une lecture claire (planner uniquement)
const SNAP_MIN = 5; // pas d'accroche

// Print/export-only scaling with lunch compression (keeps planner UI unchanged)
const PRINT_PX_PER_MIN = 4; // 4px = 1 minute for better readability in PDF
const PRINT_LUNCH_VISUAL_SCALE = 0.125; // 12.5% visual height for lunch gap (half of previous)
const INTER_BLOCK_GAP = 2; // pixel gap between successive blocks to avoid visual collisions

// Piecewise mapping: compress [lunchStart, lunchEnd] by PRINT_LUNCH_VISUAL_SCALE
function timeToYPrint(min: number, dayStart: number, lunchStart: number, lunchEnd: number): number {
  const px = PRINT_PX_PER_MIN;
  if (min <= lunchStart) return (min - dayStart) * px;
  const pre = (lunchStart - dayStart) * px;
  if (min <= lunchEnd) return pre + (min - lunchStart) * px * PRINT_LUNCH_VISUAL_SCALE;
  const lunchCompressed = (lunchEnd - lunchStart) * px * PRINT_LUNCH_VISUAL_SCALE;
  return pre + lunchCompressed + (min - lunchEnd) * px;
}

// ===== Templates d'export PDF (unique) =====
const TEMPLATES = [
  { key: 'classic', name: 'Classique',   header: 'bg-blue-600 text-white',   card: 'border-blue-200',  gridBg: 'bg-white' },
  { key: 'pastel',  name: 'Pastel',      header: 'bg-rose-500 text-white',   card: 'border-rose-200',  gridBg: 'bg-rose-50' },
  { key: 'mono',    name: 'Monochrome',  header: 'bg-gray-900 text-white',   card: 'border-gray-300',  gridBg: 'bg-white' },
 ] as const;
type TemplateKey = typeof TEMPLATES[number]['key']

export default function EDTWizard() {
  // ===== Etat principal =====
  // Types are declared at top of file
  const [step, setStep] = useState<number>(1);
  const [klass, setKlass] = useState<Klass>("CM1");
  const [days, setDays] = useState<Day[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("edt_days_v2");
      if (saved) return JSON.parse(saved) as Day[];
    }
    return DEFAULT_DAYS;
  });
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("edt_blocks_v2");
      if (saved) return JSON.parse(saved) as Block[];
    }
    return [];
  });
  const [customSubjects, setCustomSubjects] = useState<Subject[] | null>(null);
  const [editing, setEditing] = useState<{ open:boolean; id:string|null; value:string }>({ open:false, id:null, value:"" });
  const [exportTemplate, setExportTemplate] = useState<TemplateKey>('classic');
  const [exportTitle, setExportTitle] = useState<string>('');
  const [exporting, setExporting] = useState<boolean>(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  // Migration: ajouter des IDs aux blocs qui n'en ont pas (anciens autofill)
  useEffect(() => {
    setBlocks(prev => prev.map(b => (b && b.id ? b : { ...b, id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`), subtitle: b?.subtitle || "" })));
  }, []);

  // ===== Self-tests (développement) =====
  useEffect(() => {
    try {
      // 0) time utils
      console.assert(toMin('08:00') === 480 && toHHMM(480) === '8:00', 'toMin/toHHMM de base');
      // 1) TEMPLATES unique & clés uniques
      console.assert(Array.isArray(TEMPLATES) && TEMPLATES.length >= 1, 'TEMPLATES doit être un tableau non vide');
      console.assert(new Set(TEMPLATES.map(t=>t.key)).size === TEMPLATES.length, 'Clés de TEMPLATES dupliquées');
      // 2) Couleurs disponibles
      const allSubj = [...SUBJECTS.C2, ...SUBJECTS.C3].map(s=>s.key);
      allSubj.forEach(k => console.assert(SUBJECT_COLORS[k] || SUBJECT_COLORS.autre, `Couleur manquante pour ${k}`));
      // 3) CHUNK/MIN_CHUNK cohérents
      Object.keys(CHUNK).forEach(k => console.assert(allSubj.includes(k as SubjectKey), `CHUNK matière inconnue: ${k}`));
      Object.keys(MIN_CHUNK).forEach(k => console.assert(allSubj.includes(k as SubjectKey), `MIN_CHUNK matière inconnue: ${k}`));
    } catch (_) {}
  }, []);

  // Self-test export/sanitize
  useEffect(() => {
    try {
      const el = document.createElement('div');
      el.setAttribute('style','color: oklch(0.7 0.1 120); background-image: linear-gradient(90deg, oklch(0.7 0.1 120), oklch(0.6 0.2 240));');
      sanitizeOklchInClone(el);
      const style = el.getAttribute('style') || '';
      console.assert(!style.includes('oklch'), 'sanitizeOklchInClone doit supprimer oklch');
    } catch(_) {}
  }, []);
  
  const cycle: Cycle = CLASS_TO_CYCLE[klass];
  const subjects: Subject[] = customSubjects || SUBJECTS[cycle];
  const dayMap = useMemo<Record<DayKey, Day>>(() => Object.fromEntries(days.map(d => [d.key, d])) as unknown as Record<DayKey, Day>, [days]);

  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("edt_days_v2", JSON.stringify(days)); }, [days]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("edt_blocks_v2", JSON.stringify(blocks)); }, [blocks]);

  // ===== Calculs volumes =====
  const requiredByKey = useMemo<Partial<Record<SubjectKey, number>>>(() => {
    const map: Partial<Record<SubjectKey, number>> = {}; subjects.forEach(s => { map[s.key] = s.minutes; }); return map;
  }, [subjects]);
  const scheduledByKey = useMemo<Partial<Record<SubjectKey, number>>>(() => {
    const sums: Partial<Record<SubjectKey, number>> = {}; blocks.forEach(b => { const dur = Math.max(0, toMin(b.end) - toMin(b.start)); const prev = sums[b.subject] || 0; sums[b.subject] = prev + dur; }); return sums;
  }, [blocks]);
  const remainingByKey = useMemo<Partial<Record<SubjectKey, number>>>(() => {
    const rem: Partial<Record<SubjectKey, number>> = {}; subjects.forEach(s => { const req = requiredByKey[s.key]||0; const prog = scheduledByKey[s.key]||0; rem[s.key] = req - prog; }); return rem;
  }, [subjects, requiredByKey, scheduledByKey]);

  // ===== Fonctions horaires =====
  function getRecessIntervals(dayObj: Day): [number, number][] {
    const r1s = toMin(dayObj.rec1Start), r1e = r1s + (dayObj.rec1Dur||0);
    const r2s = toMin(dayObj.rec2Start), r2e = r2s + (dayObj.rec2Dur||0);
    return [[r1s,r1e],[r2s,r2e]];
  }
  function getTeachingIntervals(dayObj: Day): [number, number][] {
    const ms = toMin(dayObj.morningStart), ls = toMin(dayObj.lunchStart);
    const le = toMin(dayObj.lunchEnd), de = toMin(dayObj.dayEnd);
    const arr: [number, number][] = [];
    if (ms < ls) arr.push([ms, ls]);
    if (le < de) arr.push([le, de]);
    return arr;
  }
  function touchesRecess(dayObj: Day, s: number, e: number): boolean { return getRecessIntervals(dayObj).some(([rs,re]) => overlaps(s,e,rs,re)); }
  function isInsideTeaching(dayObj: Day, s: number, e: number): boolean { return getTeachingIntervals(dayObj).some(([ts,te]) => ts <= s && e <= te); }

  function blockConflict(newBlock: NewBlock | Block, ignoreId: string | null = null): string | null {
    const d = dayMap[newBlock.day]; if (!d || !d.enabled) return "Jour désactivé.";
    const s = toMin(newBlock.start), e = toMin(newBlock.end);
    if (e <= s) return "Fin avant début.";
    if (!isInsideTeaching(d, s, e)) return "Hors des heures de classe (cantine ou hors plage).";
    if (touchesRecess(d, s, e)) return "Chevauche une récréation.";
    const sameDay = blocks.filter(b => b.day === newBlock.day && b.id !== ignoreId);
    if (sameDay.some(b => overlaps(s, e, toMin(b.start), toMin(b.end)))) return "Chevauche un autre créneau.";
    return null;
  }

  function addBlock(b: NewBlock): boolean { const err = blockConflict(b); if (err){ alert(err); return false; } setBlocks(prev => [...prev, { ...b, subtitle: b.subtitle || "", id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`) }]); return true; }
  function updateBlock(id: string, patch: Partial<Block>): void { setBlocks(prev => prev.map(b => b.id===id?{...b, ...patch}:b)); }
  function removeBlock(id: string): void { setBlocks(prev => prev.filter(b => b.id!==id)); }

  // ===== Trouver un créneau valide proche (utile au drop) =====
  function findNearestValidStart(dayKey: DayKey, baseStartMin: number, duration: number = 60): number | null {
    const d = dayMap[dayKey]; if (!d) return null;
    const intervals = getTeachingIntervals(d);
    const tried = new Set();
    for (let delta=0; delta<=240; delta+=SNAP_MIN){
      const candidates = delta===0? [baseStartMin] : [baseStartMin+delta, baseStartMin-delta];
      for (const s of candidates){
        if (tried.has(s)) continue; tried.add(s);
        const e = s + duration;
        const inside = intervals.some(([ts,te]) => ts <= s && e <= te);
        if (!inside) continue;
        const tmp: NewBlock = { day: dayKey, start: toHHMM(s), end: toHHMM(e), subject: (subjects[0]?.key ?? 'fr') as SubjectKey, subtitle: "" };
        if (!touchesRecess(d, s, e)){
          const err = blockConflict(tmp);
          if (!err) return s;
        }
      }
    }
    return null;
  }

  // ======= Wizard Écran 1 (paramétrages) =======
  function ScreenSetup(): ReactElement {
    return (
      <div className="grid gap-4">
        <div className="rounded-2xl border p-4 bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-3">1) Choix de la classe</h2>
          <div className="flex flex-wrap gap-2">
            {["CP","CE1","CE2","CM1","CM2"].map(c => (
              <button key={c} onClick={()=>setKlass(c as Klass)} className={`px-3 py-2 rounded-2xl border shadow-sm ${klass===c?"bg-blue-600 text-white border-blue-600":"bg-gray-50"}`}>{c}</button>
            ))}
          </div>
          <div className="text-sm text-gray-600 mt-2">Cycle : <span className="font-medium">{cycle}</span></div>
        </div>

        <div className="rounded-2xl border p-4 bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-3">2) Jours d'école</h2>
          <div className="grid md:grid-cols-5 gap-3">
            {days.map(d => (
              <label key={d.key} className="flex items-center gap-2 p-2 rounded-xl border bg-gray-50">
                <input type="checkbox" checked={d.enabled} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x, enabled:e.target.checked}:x))} />
                <span className="font-medium">{d.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border p-4 bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-3">3) Horaires d'école</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {days.map(d => (
              <div key={d.key} className={`p-3 rounded-xl border ${d.enabled?"bg-gray-50":"opacity-60 bg-gray-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{d.label}</div>
                  <div className="text-xs text-gray-500">{d.morningStart}–{d.lunchStart} · cantine · {d.lunchEnd}–{d.dayEnd}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <label className="flex items-center justify-between">Début matin
                    <input type="time" value={d.morningStart} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,morningStart:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                  <label className="flex items-center justify-between">Début cantine
                    <input type="time" value={d.lunchStart} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,lunchStart:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                  <label className="flex items-center justify-between">Fin cantine
                    <input type="time" value={d.lunchEnd} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,lunchEnd:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                  <label className="flex items-center justify-between">Fin journée
                    <input type="time" value={d.dayEnd} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,dayEnd:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border p-4 bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-3">4) Récréations (2 par jour)</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            {days.map(d => (
              <div key={d.key} className={`p-3 rounded-xl border ${d.enabled?"bg-gray-50":"opacity-60 bg-gray-100"}`}>
                <div className="font-semibold mb-2">{d.label}</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center justify-between">Récré 1 – début
                    <input type="time" value={d.rec1Start} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,rec1Start:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                  <label className="flex items-center justify-between">Récré 1 – durée (min)
                    <input type="number" min={5} step={5} value={d.rec1Dur} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,rec1Dur:Number.parseInt(e.target.value||"0")}:x))} className="border rounded px-2 py-1 w-24" />
                  </label>
                  <label className="flex items-center justify-between">Récré 2 – début
                    <input type="time" value={d.rec2Start} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,rec2Start:e.target.value}:x))} className="border rounded px-2 py-1" />
                  </label>
                  <label className="flex items-center justify-between">Récré 2 – durée (min)
                    <input type="number" min={5} step={5} value={d.rec2Dur} onChange={e=>setDays(prev=>prev.map(x=>x.key===d.key?{...x,rec2Dur:Number.parseInt(e.target.value||"0")}:x))} className="border rounded px-2 py-1 w-24" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border p-4 bg-white shadow-sm">
          <h2 className="text-xl font-bold mb-3">5) Cantine</h2>
          <div className="text-sm text-gray-600">Les créneaux déposés ne peuvent pas chevaucher la cantine ; l'outil le vérifiera automatiquement.</div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button className="px-4 py-2 rounded-xl bg-blue-600 text-white" onClick={()=>setStep(2)}>Aller à la création de l'emploi du temps →</button>
        </div>
      </div>
    );
  }

  // New: Full-day printable column with lunch compression
  function PrintDayColumn({ day, template }: { day: Day; template: typeof TEMPLATES[number] }): ReactElement {
    const d = dayMap[day.key];
    const dayStart = toMin(d.morningStart);
    const lunchStart = toMin(d.lunchStart);
    const lunchEnd = toMin(d.lunchEnd);
    const dayEnd = toMin(d.dayEnd);

    const totalHeight = Math.max(40,
      timeToYPrint(dayEnd, dayStart, lunchStart, lunchEnd) - timeToYPrint(dayStart, dayStart, lunchStart, lunchEnd)
    );

    const dayBlocks = blocks
      .filter(b => b.day === day.key && toMin(b.start) >= dayStart && toMin(b.end) <= dayEnd)
      .sort((a,b) => toMin(a.start) - toMin(b.start));

    const gridSize = SNAP_MIN * PRINT_PX_PER_MIN;

    return (
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="px-2 py-1 text-xs bg-gray-50 border-b flex items-center justify-between">
          <div className="font-medium">Journée</div>
          <div className="text-gray-600">{d.morningStart} – {d.lunchStart} · cantine · {d.lunchEnd} – {d.dayEnd}</div>
        </div>
        <div
          className="relative"
          style={{ height: `${totalHeight}px`, backgroundSize: `100% ${gridSize}px`, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)" }}
        >
          {/* Recess overlays (compressed consistently) */}
          {getRecessIntervals(d).map(([rs,re],i)=>{
            const s = Math.max(dayStart, rs), e = Math.min(dayEnd, re);
            if (e <= s) return null;
            const top = Math.round(timeToYPrint(s, dayStart, lunchStart, lunchEnd));
            const h = Math.max(1, Math.round(timeToYPrint(e, dayStart, lunchStart, lunchEnd) - timeToYPrint(s, dayStart, lunchStart, lunchEnd)));
            return <div key={i} className="absolute inset-x-0 bg-yellow-100/70 pointer-events-none z-0" style={{ top, height: h }} title="Récréation"/>;
          })}

          {/* Lunch overlay (compressed visually) */}
          {lunchEnd > lunchStart && (
            <div
              className="absolute inset-x-0 bg-gray-100/70 border-y pointer-events-none z-0"
              style={{
                top: Math.round(timeToYPrint(lunchStart, dayStart, lunchStart, lunchEnd)),
                height: Math.max(1, Math.round(timeToYPrint(lunchEnd, dayStart, lunchStart, lunchEnd) - timeToYPrint(lunchStart, dayStart, lunchStart, lunchEnd))),
              }}
              title="Cantine"
            />
          )}

          {/* Blocks positioned with compressed mapping */}
          {dayBlocks.map(b => {
            const bs = toMin(b.start), be = toMin(b.end);
            const top = Math.round(timeToYPrint(bs, dayStart, lunchStart, lunchEnd));
            const natural = timeToYPrint(be, dayStart, lunchStart, lunchEnd) - timeToYPrint(bs, dayStart, lunchStart, lunchEnd);
            const h = Math.max(1, Math.round(natural) - INTER_BLOCK_GAP); // never exceed natural height to prevent overlaps
            const color = SUBJECT_COLORS[b.subject] || SUBJECT_COLORS.autre;
            const label = subjects.find(s=>s.key===b.subject)?.label || b.subject;
            const showLabel = h >= 14; // hide subject label if too short
            const showTimes = h >= 24; // hide times on very short blocks
            const showSubtitle = !!b.subtitle && h >= 46; // show subtitle only if enough height
            return (
              <div
                key={b.id}
                className={`absolute left-0 right-0 px-2 py-0.5 ${color} rounded-md border shadow-sm overflow-hidden z-[1] min-w-0`}
                style={{ top, height: h }}
                title={`${label} — ${b.start}–${b.end}${b.subtitle ? ` — ${b.subtitle}` : ''}`}
              >
                <div className="flex flex-col gap-[1px]">
                  <div className="flex items-center justify-between text-[11px] leading-tight min-w-0">
                    <div className="font-medium truncate whitespace-nowrap min-w-0 flex-1">{showLabel ? label : ""}</div>
                    {showTimes && (
                      <div className="tabular-nums whitespace-nowrap shrink-0">{b.start}–{b.end}</div>
                    )}
                  </div>
                  {showSubtitle && (
                    <div className="text-[10px] leading-tight italic text-gray-700 truncate whitespace-nowrap">{b.subtitle}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ======= Palette glissable =======
  function SubjectPalette(): ReactElement {
    return (
      <div className="rounded-2xl border p-4 bg-white shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Palette des matières (glisser / déposer)</h3>
          <div className="text-sm text-gray-600">Classe : <span className="font-medium">{klass}</span> · Cycle {cycle}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {subjects.map(s => {
            const left = remainingByKey[s.key] || 0;
            const color = SUBJECT_COLORS[s.key] || SUBJECT_COLORS.autre;
            return (
              <div key={s.key}
                   draggable
                   onDragStart={e=>{ e.dataTransfer.setData("text/plain", s.key); }}
                   title="Glisser-déposer dans une journée"
                   className={`cursor-grab active:cursor-grabbing select-none px-3 py-2 rounded-2xl border ${color}`}>
                <div className="text-sm font-medium">{s.label}</div>
                <div className="text-xs text-gray-700">reste : {minutesToHM(Math.max(0, left))} / {minutesToHM(s.minutes)}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ======= Zone jour (matin / aprem) avec Drop + RND =======
  function DayZone({ day, part }: { day: Day; part: TimePart }): ReactElement {
    const d = dayMap[day.key];
    const start = part==="AM"? toMin(d.morningStart) : toMin(d.lunchEnd);
    const end   = part==="AM"? toMin(d.lunchStart)   : toMin(d.dayEnd);
    const height = Math.max(40, (end - start) * PX_PER_MIN);
    const zoneRef = useRef<HTMLDivElement | null>(null);

    function onDrop(e: DragEvent<HTMLDivElement>): void {
      e.preventDefault();
      const subKey = e.dataTransfer.getData("text/plain");
      if (!subKey) return;
      const rect = zoneRef.current!.getBoundingClientRect();
      const y = clamp(0, e.clientY - rect.top, rect.height);
      const snapped = Math.round((y / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN;
      const startMin = start + snapped;
      const duration = 60; // défaut 1h
      const newB: NewBlock = { day: day.key, subject: subKey as SubjectKey, start: toHHMM(startMin), end: toHHMM(startMin + duration), subtitle: "" };
      const err = blockConflict(newB);
      if (!err) { addBlock(newB); return; }
      const alt = findNearestValidStart(day.key, startMin, duration);
      if (alt!=null){ addBlock({ ...newB, start: toHHMM(alt), end: toHHMM(alt+duration) }); return; }
      alert(err);
    }

    function allowDrop(e: DragEvent<HTMLDivElement>): void { e.preventDefault(); }

    const dayBlocks = blocks.filter(b => b.day===day.key && toMin(b.start)>=start && toMin(b.end)<=end)
                            .sort((a,b) => toMin(a.start)-toMin(b.start));

    return (
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs bg-gray-50 border-b flex items-center justify-between">
          <div className="font-medium">{part === "AM"? "Matin" : "Après-midi"}</div>
          <div className="text-gray-600">{toHHMM(start)} – {toHHMM(end)}</div>
        </div>
        <div ref={zoneRef}
             onDrop={onDrop}
             onDragOver={allowDrop}
             className="relative"
             style={{height: `${height}px`, backgroundSize: `100% ${SNAP_MIN*PX_PER_MIN}px`, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.04) 1px, transparent 1px)"}}
        >
          {getRecessIntervals(d).map(([rs,re],i)=>{
            const s = clamp(start, rs, end), e = clamp(start, re, end);
            if (e<=s) return null;
            return <div key={i} className="absolute inset-x-0 bg-yellow-100/70" style={{ top: (s-start)*PX_PER_MIN, height: (e-s)*PX_PER_MIN }} title="Récréation"/>;
          })}

          {dayBlocks.map(b => (
            <BlockRnd key={b.id} block={b} zoneStart={start} zoneEnd={end} />
          ))}
        </div>
      </div>
    );
  }

  function BlockRnd({ block, zoneStart, zoneEnd }: { block: Block; zoneStart: number; zoneEnd: number }): ReactElement {
    const { id, subject } = block;
    const color = SUBJECT_COLORS[subject] || SUBJECT_COLORS.autre;
    const s = toMin(block.start), e = toMin(block.end);
    const top = (s - zoneStart) * PX_PER_MIN;
    const height = Math.max(20, (e - s) * PX_PER_MIN);

    return (
      <Rnd
        bounds="parent"
        cancel=".no-drag"
        enableResizing={{ top:true, bottom:true, left:false, right:false, topLeft:false, topRight:false, bottomLeft:false, bottomRight:false }}
        size={{ width: "100%", height }}
        position={{ x: 0, y: top }}
        onDragStop={(evt, data) => {
          const newStart = Math.round((data.y / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN + zoneStart;
          const dur = e - s;
          const patch = { start: toHHMM(newStart), end: toHHMM(newStart + dur) };
          const err = blockConflict({ ...block, ...patch }, id);
          if (err) { alert(err); return; }
          updateBlock(id, patch);
        }}
        onResizeStop={(evt, dir, ref, delta, position) => {
          const newY = Math.round(position.y / (PX_PER_MIN*SNAP_MIN)) * (PX_PER_MIN*SNAP_MIN);
          const newH = Math.round(ref.offsetHeight / (PX_PER_MIN*SNAP_MIN)) * (PX_PER_MIN*SNAP_MIN);
          const newStart = zoneStart + Math.round(newY / PX_PER_MIN);
          const newEnd = zoneStart + Math.round((newY + newH) / PX_PER_MIN);
          const patch = { start: toHHMM(newStart), end: toHHMM(newEnd) };
          const err = blockConflict({ ...block, ...patch }, id);
          if (err) { alert(err); return; }
          updateBlock(id, patch);
        }}
        dragAxis="y"
        enableUserSelectHack={false}
        style={{ zIndex: 1 }}
        className={`absolute left-0 right-0 px-2 py-1 border ${color} shadow-sm rounded-md`}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="font-medium truncate">{subjects.find(s=>s.key===subject)?.label || subject}</div>
          <div className="tabular-nums">{block.start}–{block.end}</div>
        </div>
        {block.subtitle && <div className="text-[11px] italic text-gray-700 truncate">{block.subtitle}</div>}
        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-600">
          <span>{minutesToHM(toMin(block.end) - toMin(block.start))}</span>
          <div className="space-x-2 no-drag">
            <button type="button" className="underline" onMouseDown={(e)=>e.stopPropagation()} onClick={()=> setEditing({ open:true, id, value: block.subtitle || "" })}>Éditer</button>
            <button type="button" className="underline" onMouseDown={(e)=>e.stopPropagation()} onClick={()=>removeBlock(id)}>Supprimer</button>
          </div>
        </div>
      </Rnd>
    );
  }

  // ======= Auto-répartition =======
  const CHUNK: Partial<Record<SubjectKey, number>> = { fr:60, maths:60, lv:45, eps:60, arts:60, qlm_emc:60, sciences:60, hg_emc:60 };
  const MIN_CHUNK: Partial<Record<SubjectKey, number>> = { fr:30, maths:30, lv:30, eps:45, arts:30, qlm_emc:30, sciences:30, hg_emc:30 };

  const PATTERN: Record<Cycle, Record<DayKey, { AM: SubjectKey[]; PM: SubjectKey[] }>> = {
    C2: {
      Mon: { AM:["fr","maths"], PM:["qlm_emc","arts","eps"] },
      Tue: { AM:["fr","maths","lv"], PM:["eps","fr","qlm_emc"] },
      Wed: { AM:["fr","maths"], PM:["arts","qlm_emc"] },
      Thu: { AM:["fr","maths","lv"], PM:["eps","qlm_emc","arts"] },
      Fri: { AM:["fr","maths"], PM:["arts","qlm_emc"] },
    },
    C3: {
      Mon: { AM:["fr","maths"], PM:["hg_emc","arts"] },
      Tue: { AM:["fr","maths","lv"], PM:["eps","sciences"] },
      Wed: { AM:["fr","maths"], PM:["arts","hg_emc"] },
      Thu: { AM:["fr","maths","lv"], PM:["eps","hg_emc"] },
      Fri: { AM:["fr","maths"], PM:["sciences","arts"] },
    }
  };

  function subtractSegment(windows: [number, number][], s: number, e: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [ws,we] of windows){
      const is = Math.max(ws, s), ie = Math.min(we, e);
      if (ie <= is){ out.push([ws,we]); continue; }
      if (ws < is) out.push([ws, is]);
      if (ie < we) out.push([ie, we]);
    }
    return out;
  }

  function getFreeWindows(day: Day, part: TimePart): [number, number][] {
    const d = dayMap[day.key];
    const start = part==="AM"? toMin(d.morningStart) : toMin(d.lunchEnd);
    const end   = part==="AM"? toMin(d.lunchStart)   : toMin(d.dayEnd);
    let wins = [[start, end]] as [number, number][];
    for (const [rs,re] of getRecessIntervals(d)) wins = subtractSegment(wins, rs, re);
    const dayBlocks = blocks.filter(b => b.day===day.key && !(toMin(b.end)<=start || toMin(b.start)>=end));
    for (const b of dayBlocks) wins = subtractSegment(wins, Math.max(start, toMin(b.start)), Math.min(end, toMin(b.end)));
    return wins.filter(([s,e]) => e - s >= 15).sort((a,b)=>a[0]-b[0]);
  }

  function autofill(): void {
    const rem: Partial<Record<SubjectKey, number>> = {}; subjects.forEach(s=> { rem[s.key] = s.minutes; });
    const newBlocks: NewBlock[] = [];
    const dayOrder = ["Mon","Tue","Wed","Thu","Fri"] as DayKey[];

    for (const key of dayOrder){
      const d = dayMap[key]; if (!d || !d.enabled) continue;
      const plan = (PATTERN[cycle][key]) || { AM: subjects.map(s=>s.key), PM: subjects.map(s=>s.key) };
      for (const part of ["AM","PM"] as const) {
        const start = part==="AM"? toMin(d.morningStart) : toMin(d.lunchEnd);
        const end   = part==="AM"? toMin(d.lunchStart)   : toMin(d.dayEnd);
        let cur = start;
        let idx = 0; const order: SubjectKey[] = [...plan[part]];
        while (cur < end){
          const recs = getRecessIntervals(d);
          const hitRec = recs.find(([rs,re]) => cur >= rs && cur < re);
          if (hitRec){ cur = hitRec[1]; continue; }
          const nextRecStart = recs.map(([rs])=>rs).filter(rs => rs>cur).sort((a,b)=>a-b)[0] || end;
          const hardEnd = Math.min(nextRecStart, end);
          if (hardEnd - cur < 15) break;

          let chosen: SubjectKey | null = null; let guard = 0;
          while (guard++ < order.length){
            const k = order[idx % order.length]; idx++;
            if ((rem[k]||0) > 0){ chosen = k; break; }
          }
          if (!chosen) { cur = hardEnd; continue; }

          const minChunk = (MIN_CHUNK[chosen] || 30);
          const nominal = (CHUNK[chosen] || 60);
          const space = hardEnd - cur;
          let len = Math.min(nominal, rem[chosen] || 0, space);
          len = Math.floor(len / SNAP_MIN) * SNAP_MIN;
          if (len < minChunk){
            if ((rem[chosen] || 0) <= space && (rem[chosen] || 0) >= 15){
              len = Math.floor((rem[chosen] || 0)/SNAP_MIN)*SNAP_MIN;
            }
          }
          if (len >= 15){
            const b: NewBlock = { day: key, subject: chosen, start: toHHMM(cur), end: toHHMM(cur+len), subtitle: "" };
            newBlocks.push(b); rem[chosen] = (rem[chosen] || 0) - len; cur += len; continue;
          }
          const prev = cur; cur = Math.min(hardEnd, cur + SNAP_MIN); if (cur === prev) break;
        }
      }
    }
    setBlocks(newBlocks.map(b => ({ ...b, id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`), subtitle: b.subtitle || "" })));
  }

  function completeFill(): void {
    const rem: Partial<Record<SubjectKey, number>> = {}; subjects.forEach(s => { rem[s.key] = (requiredByKey[s.key]||0) - (scheduledByKey[s.key]||0); });
    const added: NewBlock[] = [];
    const dayOrder = ["Mon","Tue","Wed","Thu","Fri"] as DayKey[];

    for (const key of dayOrder){
      const d = dayMap[key]; if (!d || !d.enabled) continue;
      const plan = (PATTERN[cycle][key]) || { AM: subjects.map(s=>s.key), PM: subjects.map(s=>s.key) };
      for (const part of ["AM","PM"] as const) {
        const wins = getFreeWindows(d, part);
        let idx = 0; const order: SubjectKey[] = [...plan[part]];
        for (const [ws,we] of wins){
          let cur = ws;
          while (cur < we){
            let chosen: SubjectKey | null = null; let guard = 0;
            while (guard++ < order.length){
              const k = order[idx % order.length]; idx++;
              if ((rem[k]||0) > 0){ chosen = k; break; }
            }
            if (!chosen) break;

            const minChunk = MIN_CHUNK[chosen] || 30;
            const nominal = CHUNK[chosen] || 60;
            const space = we - cur;
            let len = Math.min(nominal, (rem[chosen] ?? 0), space);
            len = Math.floor(len / SNAP_MIN) * SNAP_MIN;
            if (len < minChunk){
              const remVal = rem[chosen] ?? 0;
              if (remVal <= space && remVal >= 15){
                len = Math.floor(remVal/SNAP_MIN)*SNAP_MIN;
              }
            }
            if (len >= 15){
              const b: NewBlock = { day: key, subject: chosen, start: toHHMM(cur), end: toHHMM(cur+len), subtitle: "" };
              added.push(b); rem[chosen] = (rem[chosen] || 0) - len; cur += len; continue;
            }
            const prev = cur; cur = Math.min(we, cur + SNAP_MIN); if (cur === prev) break;
          }
        }
      }
    }

    if (added.length === 0){ alert("Aucun espace libre suffisant pour compléter."); return; }
    setBlocks([...blocks, ...added.map(b => ({ ...b, id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`), subtitle: b.subtitle || "" }))]);
  }

  // ======= Tableau planifiable (Écran 2) =======
  const printRef = useRef<HTMLDivElement | null>(null);
  function ScreenPlanner(){
    const enabledDays = days.filter(d=>d.enabled);

    return (
      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Création de l'emploi du temps</h2>
          <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={()=>setStep(1)}>← Paramètres</button>
            <button className="px-3 py-2 rounded-xl bg-gray-100" onClick={()=>setBlocks([])}>Vider</button>
            <button className="px-3 py-2 rounded-xl bg-emerald-600 text-white" onClick={autofill}>Remplir automatiquement</button>
            {blocks.length > 0 && (
              <button className="px-3 py-2 rounded-xl bg-emerald-700 text-white" onClick={completeFill}>Compléter automatiquement</button>
            )}
            <button className="px-3 py-2 rounded-xl bg-blue-600 text-white" onClick={()=>setStep(3)}>Exporter en PDF</button>
          </div>
        </div>

        <SubjectPalette />

        <div className="grid lg:grid-cols-4 gap-4" ref={printRef}>
          {enabledDays.map(d => (
            <div key={d.key} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
              <div className="px-3 py-2 bg-blue-50 border-b flex items-center justify-between">
                <div className="font-semibold">{d.label}</div>
                <div className="text-xs text-gray-600">{d.morningStart}–{d.lunchStart} · {d.lunchEnd}–{d.dayEnd}</div>
              </div>
              <div className="p-2 grid gap-2">
                <DayZone day={d} part="AM" />
                <DayZone day={d} part="PM" />
              </div>
            </div>
          ))}
        </div>

        <CompliancePanel />
      </div>
    );
  }

  // ======= Impression statique (pour export) =======
  function PrintDayPart({ day, part, template }: { day: Day; part: TimePart; template: typeof TEMPLATES[number] }): ReactElement {
    const d = dayMap[day.key];
    const start = part==="AM"? toMin(d.morningStart) : toMin(d.lunchEnd);
    const end   = part==="AM"? toMin(d.lunchStart)   : toMin(d.dayEnd);
    const height = Math.max(40, (end - start));
    const blocksForPart = blocks
      .filter(b => b.day===day.key && toMin(b.start)>=start && toMin(b.end)<=end)
      .sort((a,b)=>toMin(a.start)-toMin(b.start));
    return (
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="px-2 py-1 text-xs bg-gray-50 border-b flex items-center justify-between">
          <div className="font-medium">{part === 'AM' ? 'Matin' : 'Après‑midi'}</div>
          <div className="text-gray-600">{toHHMM(start)} – {toHHMM(end)}</div>
        </div>
        <div className="relative" style={{ height: `${height}px`, backgroundSize: `100% ${SNAP_MIN}px`, backgroundImage: "linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px)" }}>
          {blocksForPart.map(b => {
            const bs = toMin(b.start), be = toMin(b.end);
            const top = bs - start; const h = Math.max(16, be - bs);
            const color = SUBJECT_COLORS[b.subject] || SUBJECT_COLORS.autre;
            return (
              <div key={b.id} className={`absolute left-0 right-0 px-2 py-1 ${color} rounded-md border shadow-sm`} style={{ top, height: h }}>
                <div className="flex items-center justify-between text-[11px]">
                  <div className="font-medium truncate">{subjects.find(s=>s.key===b.subject)?.label || b.subject}</div>
                  <div className="tabular-nums">{b.start}–{b.end}</div>
                </div>
                {b.subtitle && <div className="text-[10px] italic text-gray-700 truncate">{b.subtitle}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function PrintGrid({ template }: { template: TemplateKey }): ReactElement {
    const t = TEMPLATES.find(x=>x.key===template) || TEMPLATES[0];
    const enabledDays = days.filter(d=>d.enabled);
    return (
      <div className={`rounded-2xl border ${t.card} ${t.gridBg} p-2 w-full`} ref={exportRef}>
        <div className={`px-4 py-3 rounded-xl ${t.header} mb-3`}>
          <div className="text-lg font-bold">Emploi du temps – {klass} (Cycle {cycle})</div>
          {exportTitle && <div className="text-sm opacity-90">{exportTitle}</div>}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {enabledDays.map(d => (
            <div key={d.key} className="rounded-xl border bg-white overflow-hidden">
              <div className="px-3 py-2 bg-gray-100 border-b flex items-center justify-between">
                <div className="font-semibold">{d.label}</div>
                <div className="text-xs text-gray-600">{d.morningStart}–{d.lunchStart} · {d.lunchEnd}–{d.dayEnd}</div>
              </div>
              <div className="p-2">
                <PrintDayColumn day={d} template={t} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function PrintSummary({ template }: { template: TemplateKey }): ReactElement {
    const t = TEMPLATES.find(x=>x.key===template) || TEMPLATES[0];
    const totalRequired = subjects.reduce((a,s)=>a+s.minutes,0);
    const totalScheduled = Object.values(scheduledByKey).reduce((a,v)=>a+v,0);
    return (
      <div className={`rounded-2xl border ${t.card} ${t.gridBg} p-3 w-full`} ref={summaryRef}>
        <div className={`px-4 py-3 rounded-xl ${t.header} mb-3`}>
          <div className="text-lg font-bold">Volumes hebdomadaires (sans récré) – {klass} (Cycle {cycle})</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Matière</th>
                <th>Requis</th>
                <th>Programmé</th>
                <th>Reste</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(s=>{
                const prog = scheduledByKey[s.key]||0; const rest = (requiredByKey[s.key]||0) - prog;
                return (
                  <tr key={s.key} className="border-b">
                    <td className="py-2">
                      <span className={`inline-block px-2 py-1 rounded border ${SUBJECT_COLORS[s.key]||SUBJECT_COLORS.autre}`}>{s.label}</span>
                    </td>
                    <td>{minutesToHM(s.minutes)}</td>
                    <td>{minutesToHM(prog)}</td>
                    <td className={`${rest===0?"text-green-700": rest>0?"text-amber-700":"text-red-700"}`}>{minutesToHM(Math.max(0, rest))}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td className="py-2">Total</td>
                <td>{minutesToHM(totalRequired)}</td>
                <td>{minutesToHM(totalScheduled)}</td>
                <td className={`${(totalRequired-totalScheduled)===0?"text-green-700":(totalRequired-totalScheduled)>0?"text-amber-700":"text-red-700"}`}>{minutesToHM(Math.max(0, totalRequired - totalScheduled))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function ScreenExport(): ReactElement {
    async function doExport(){
      try {
        setExporting(true);
        await new Promise(r=>setTimeout(r,0));
        const node1 = exportRef.current;
        const node2 = summaryRef.current;
        if (!node1) throw new Error("Aperçu de l'emploi du temps introuvable");

        const pdf = new jsPDF({ orientation:'landscape', unit:'pt', format:'a4' });
        const canvas1 = await rasterizeWithFallback(node1);
        const pw = pdf.internal.pageSize.getWidth();
        const ph = pdf.internal.pageSize.getHeight();
        const r1 = Math.min(pw / canvas1.width, ph / canvas1.height);
        const w1 = canvas1.width * r1, h1 = canvas1.height * r1;
        pdf.addImage(canvas1.toDataURL('image/png'), 'PNG', (pw - w1)/2, (ph - h1)/2, w1, h1);

        if (node2){
          const canvas2 = await rasterizeWithFallback(node2);
          pdf.addPage();
          const r2 = Math.min(pw / canvas2.width, ph / canvas2.height);
          const w2 = canvas2.width * r2, h2 = canvas2.height * r2;
          pdf.addImage(canvas2.toDataURL('image/png'), 'PNG', (pw - w2)/2, (ph - h2)/2, w2, h2);
        }
        pdf.save(`EDT_${klass}_${cycle}.pdf`);
      } catch (err) {
        console.error(err);
        alert("Erreur lors de l'export PDF");
      } finally {
        setExporting(false);
      }
    }
    return (
      <div className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Exporter en PDF</h2>
          <div className="flex items-center gap-2">
            <select
              className="px-2 py-1 border rounded"
              value={exportTemplate}
              onChange={e=>setExportTemplate(e.target.value as TemplateKey)}
            >
              {TEMPLATES.map(t=> <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <input
              type="text"
              className="px-2 py-1 border rounded"
              placeholder="Titre personnalisé (optionnel)"
              value={exportTitle}
              onChange={e=>setExportTitle(e.target.value)}
            />
            <button className="px-3 py-2 rounded-xl bg-blue-600 text-white" disabled={exporting} onClick={doExport}>
              {exporting ? "Export en cours..." : "Exporter en PDF"}
            </button>
          </div>
        </div>
        <PrintGrid template={exportTemplate} />
        <PrintSummary template={exportTemplate} />
      </div>
    );
  }

  // ======= Rendu principal selon l'étape =======
  function CompliancePanel(): ReactElement | null { return null; }
  return (
    <div className="grid gap-4">
      {step === 1 && <ScreenSetup />}
      {step === 2 && <ScreenPlanner />}
      {step === 3 && <ScreenExport />}
    </div>
  );
}
