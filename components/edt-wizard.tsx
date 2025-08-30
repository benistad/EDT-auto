"use client"

import { useState, useRef, useMemo, useEffect } from "react"
import jsPDF from "jspdf"
import { Rnd } from "react-rnd"
import { saveTimetable, loadTimetables, deleteTimetable, TimetableSave } from "../lib/supabase"
import { generateObject } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { z } from "zod"
import { minutesToHM } from "@/lib/utils"
import type { DayKey, DayConfig, Block, SubjectDef, ClassLevel } from "@/lib/types"
import { rasterizeWithFallback } from "@/lib/pdf-utils"

// Type definitions
type CycleKey = "C2" | "C3";
type TemplateKey = "classic" | "pastel" | "mono";
type NewBlock = { day: DayKey; start: string; end: string; subject: string; subtitle?: string };

// Type guards
function isKlass(v: unknown): v is ClassLevel {
  return v === "CP" || v === "CE1" || v === "CE2" || v === "CM1" || v === "CM2"
}

// Zod schemas for runtime validation of loaded data
const zTime = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: 'HH:MM expected' })
const zDayKey = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri"]) 
const zDayConfig = z.object({
  key: zDayKey,
  label: z.string(),
  enabled: z.boolean(),
  morningStart: zTime,
  lunchStart: zTime,
  lunchEnd: zTime,
  dayEnd: zTime,
  rec1Start: zTime,
  rec1Dur: z.number().int().min(0),
  rec2Start: zTime,
  rec2Dur: z.number().int().min(0),
})
const zSubjectDef = z.object({ key: z.string(), label: z.string(), minutes: z.number().int().min(0) })
const zBlock = z.object({
  id: z.string(),
  day: zDayKey,
  subject: z.string(),
  start: zTime,
  end: zTime,
  subtitle: z.string().optional(),
})
const zTimetableSave = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  class_name: z.enum(["CP","CE1","CE2","CM1","CM2"]),
  days_config: z.array(zDayConfig),
  blocks: z.array(zBlock),
  subjects: z.array(zSubjectDef),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

// S'assurer que la variable d'environnement est disponible globalement
if (typeof window !== "undefined") {
  // Côté client
  (window as any).process = {
    ...(window as any).process,
    env: {
      ...((window as any).process?.env || {}),
      OPENAI_API_KEY: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
    },
  }
}

// Initialiser explicitement le client OpenAI côté client avec la clé publique
const openaiClient = createOpenAI({ apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY || "" })
// Log minimal sur la présence de la clé (sans l'exposer)
const HAS_OPENAI_KEY = !!process.env.NEXT_PUBLIC_OPENAI_API_KEY
console.log("[v0] OpenAI key present:", HAS_OPENAI_KEY)

// Emploi du temps – Assistant CP→CM2 (Wizard + Drag & Drop + Export PDF)
// Single-file React component with Tailwind CSS

// PDF export helpers centralized in '@/lib/pdf-utils'

// ===== Utilitaires temps (HH:MM) + mini tests =====
function toMin(hhmm: string) {
  if (!hhmm || typeof hhmm !== "string") return 0
  const [h, m] = hhmm.split(":").map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}
function toHHMM(m: number) {
  const total = Math.max(0, Math.round(m))
  const h = Math.floor(total / 60)
  const mm = (total % 60).toString().padStart(2, "0")
  return `${h}:${mm}`
}
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd)
}
function clamp(min: number, val: number, max: number) {
  return Math.max(min, Math.min(max, val))
}

// Helper pour imposer un timeout typé
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise
      .then((v) => {
        clearTimeout(timer)
        resolve(v)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

// ===== Volumes hebdo SANS récré (d'après doc C2/C3) =====
const SUBJECTS: Record<CycleKey, SubjectDef[]> = {
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
}

const CLASS_TO_CYCLE: Record<ClassLevel, CycleKey> = { CP: "C2", CE1: "C2", CE2: "C2", CM1: "C3", CM2: "C3" }

const DEFAULT_DAYS: DayConfig[] = [
  {
    key: "Mon",
    label: "Lundi",
    enabled: true,
    morningStart: "08:30",
    lunchStart: "12:00",
    lunchEnd: "13:30",
    dayEnd: "16:30",
    rec1Start: "10:15",
    rec1Dur: 15,
    rec2Start: "15:00",
    rec2Dur: 15,
  },
  {
    key: "Tue",
    label: "Mardi",
    enabled: true,
    morningStart: "08:30",
    lunchStart: "12:00",
    lunchEnd: "13:30",
    dayEnd: "16:30",
    rec1Start: "10:15",
    rec1Dur: 15,
    rec2Start: "15:00",
    rec2Dur: 15,
  },
  {
    key: "Wed",
    label: "Mercredi",
    enabled: false,
    morningStart: "08:30",
    lunchStart: "12:00",
    lunchEnd: "13:30",
    dayEnd: "16:30",
    rec1Start: "10:15",
    rec1Dur: 15,
    rec2Start: "15:00",
    rec2Dur: 15,
  },
  {
    key: "Thu",
    label: "Jeudi",
    enabled: true,
    morningStart: "08:30",
    lunchStart: "12:00",
    lunchEnd: "13:30",
    dayEnd: "16:30",
    rec1Start: "10:15",
    rec1Dur: 15,
    rec2Start: "15:00",
    rec2Dur: 15,
  },
  {
    key: "Fri",
    label: "Vendredi",
    enabled: true,
    morningStart: "08:30",
    lunchStart: "12:00",
    lunchEnd: "13:30",
    dayEnd: "16:30",
    rec1Start: "10:15",
    rec1Dur: 15,
    rec2Start: "15:00",
    rec2Dur: 15,
  },
]

const PX_PER_MIN = 4 // 4px = 1 minute pour colonnes plus longues et meilleure lisibilité
const SNAP_MIN = 5 // pas d'accroche de 5 minutes
const LUNCH_VISUAL_SCALE = 0.5 // Compression visuelle de la cantine (50% de la hauteur réelle)

// Conversion temps(min) -> position Y (px) avec compression visuelle sur l'intervalle cantine
function timeToY(min: number, dayStart: number, lunchStart: number, lunchEnd: number): number {
  const px = PX_PER_MIN
  if (min <= lunchStart) return (min - dayStart) * px
  const pre = (lunchStart - dayStart) * px
  if (min <= lunchEnd) return pre + (min - lunchStart) * px * LUNCH_VISUAL_SCALE
  const lunchCompressed = (lunchEnd - lunchStart) * px * LUNCH_VISUAL_SCALE
  return pre + lunchCompressed + (min - lunchEnd) * px
}

// Conversion position Y (px) -> temps(min) inverse de timeToY
function yToTime(y: number, dayStart: number, lunchStart: number, lunchEnd: number): number {
  const px = PX_PER_MIN
  const pre = (lunchStart - dayStart) * px
  const lunchCompressed = (lunchEnd - lunchStart) * px * LUNCH_VISUAL_SCALE
  if (y <= pre) return dayStart + y / px
  if (y <= pre + lunchCompressed) return lunchStart + (y - pre) / (px * LUNCH_VISUAL_SCALE)
  return lunchEnd + (y - pre - lunchCompressed) / px
}

// ===== Templates d'export PDF (unique) =====
const TEMPLATES = [
  {
    key: "classic",
    name: "Classique",
    header: "bg-primary text-primary-foreground",
    card: "border-primary/20",
    gridBg: "bg-white",
  },
  {
    key: "pastel",
    name: "Pastel",
    header: "bg-accent text-accent-foreground",
    card: "border-accent/20",
    gridBg: "bg-accent/5",
  },
  {
    key: "mono",
    name: "Monochrome",
    header: "bg-foreground text-background",
    card: "border-border",
    gridBg: "bg-white",
  },
] as const

// ======= Auto-répartition =======
const CHUNK = { fr: 60, maths: 60, lv: 45, eps: 60, arts: 60, qlm_emc: 60, sciences: 60, hg_emc: 60 }
const MIN_CHUNK = { fr: 30, maths: 30, lv: 30, eps: 45, arts: 30, qlm_emc: 30, sciences: 30, hg_emc: 30 }

const PATTERN = {
  C2: {
    Mon: { AM: ["fr", "maths"], PM: ["qlm_emc", "arts", "eps"] },
    Tue: { AM: ["fr", "maths", "lv"], PM: ["eps", "fr", "qlm_emc"] },
    Wed: { AM: ["fr", "maths"], PM: ["arts", "qlm_emc"] },
    Thu: { AM: ["fr", "maths", "lv"], PM: ["eps", "qlm_emc", "arts"] },
    Fri: { AM: ["fr", "maths"], PM: ["arts", "qlm_emc"] },
  },
  C3: {
    Mon: { AM: ["fr", "maths"], PM: ["hg_emc", "arts"] },
    Tue: { AM: ["fr", "maths", "lv"], PM: ["eps", "sciences"] },
    Wed: { AM: ["fr", "maths"], PM: ["arts", "hg_emc"] },
    Thu: { AM: ["fr", "maths", "lv"], PM: ["eps", "hg_emc"] },
    Fri: { AM: ["fr", "maths"], PM: ["sciences", "arts"] },
  },
}

const SUBJECT_COLORS: Record<string, string> = {
  fr: "bg-indigo-100 border-indigo-300",
  maths: "bg-rose-100 border-rose-300",
  lv: "bg-amber-100 border-amber-300",
  eps: "bg-emerald-100 border-emerald-300",
  arts: "bg-pink-100 border-pink-300",
  qlm_emc: "bg-sky-100 border-sky-300",
  sciences: "bg-teal-100 border-teal-300",
  hg_emc: "bg-cyan-100 border-cyan-300",
  autre: "bg-gray-100 border-gray-300",
}

// Couleur de remplissage explicite (évite les classes dynamiques purgées par Tailwind)
const SUBJECT_BAR_BG: Record<string, string> = {
  fr: "bg-indigo-400",
  maths: "bg-rose-400",
  lv: "bg-amber-400",
  eps: "bg-emerald-400",
  arts: "bg-pink-400",
  qlm_emc: "bg-sky-400",
  sciences: "bg-teal-400",
  hg_emc: "bg-cyan-400",
  autre: "bg-gray-400",
}

export default function EDTWizard() {
  // ===== Etat principal =====
  const [step, setStep] = useState<number>(1)
  const [klass, setKlass] = useState<ClassLevel>("CM1")
  const [days, setDays] = useState<DayConfig[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("edt_days_v2")
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const res = z.array(zDayConfig).safeParse(parsed)
          if (res.success) return res.data
        } catch {}
      }
    }
    return DEFAULT_DAYS
  })
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("edt_blocks_v2")
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const res = z.array(zBlock).safeParse(parsed)
          if (res.success) return res.data
        } catch {}
      }
    }
    return [] as Block[]
  })
  const [customSubjects, setCustomSubjects] = useState<SubjectDef[] | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("edt_custom_subjects_v2")
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const res = z.array(zSubjectDef).safeParse(parsed)
          if (res.success) return res.data
        } catch {}
      }
    }
    return null
  })
  const [showCustomize, setShowCustomize] = useState(false)
  const [editSubjects, setEditSubjects] = useState<SubjectDef[]>([])
  const [editingBlock, setEditingBlock] = useState<Block | null>(null)
  const [exportTemplate, setExportTemplate] = useState<TemplateKey>("classic")
  const [exportTitle, setExportTitle] = useState("")
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement | null>(null)
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const [savedTimetables, setSavedTimetables] = useState<TimetableSave[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [saving, setSaving] = useState(false)

  // Migration: ajouter des IDs aux blocs qui n'en ont pas (anciens autofill)
  useEffect(() => {
    setBlocks((prev) =>
      prev.map((b) =>
        b && b.id
          ? b
          : {
              ...b,
              id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
              subtitle: b?.subtitle || "",
            },
      ),
    )
  }, [])

  const cycle = CLASS_TO_CYCLE[klass]
  // Subjects for the selected cycle, or custom overrides
  const subjects: SubjectDef[] = customSubjects ?? SUBJECTS[cycle]
  const dayMap = useMemo<Record<DayKey, DayConfig>>(
    () => Object.fromEntries(days.map((d) => [d.key, d])) as Record<DayKey, DayConfig>,
    [days]
  )
  const enabledDays: DayConfig[] = days.filter((d) => d.enabled)

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("edt_days_v2", JSON.stringify(days))
  }, [days])
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("edt_blocks_v2", JSON.stringify(blocks))
  }, [blocks])
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (customSubjects) localStorage.setItem("edt_custom_subjects_v2", JSON.stringify(customSubjects))
      else localStorage.removeItem("edt_custom_subjects_v2")
    }
  }, [customSubjects])

  // Copier les horaires du lundi vers les autres jours (ne modifie pas l'état activé/désactivé)
  function copyMondayToOthers() {
    const monday = days.find((d) => d.key === "Mon")
    if (!monday) {
      alert("Jour 'Lundi' introuvable")
      return
    }
    const fields = {
      morningStart: monday.morningStart,
      lunchStart: monday.lunchStart,
      lunchEnd: monday.lunchEnd,
      dayEnd: monday.dayEnd,
      rec1Start: monday.rec1Start,
      rec1Dur: monday.rec1Dur,
      rec2Start: monday.rec2Start,
      rec2Dur: monday.rec2Dur,
    }
    const newDays = days.map((d) => (d.key === "Mon" ? d : { ...d, ...fields }))
    setDays(newDays)
  }

  // ===== Calculs volumes =====
  const requiredByKey = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    subjects.forEach((s) => (map[s.key] = s.minutes))
    return map
  }, [subjects])
  const scheduledByKey = useMemo<Record<string, number>>(() => {
    const sums: Record<string, number> = {}
    blocks.forEach((b) => {
      const dur = Math.max(0, toMin(b.end) - toMin(b.start))
      sums[b.subject] = (sums[b.subject] || 0) + dur
    })
    return sums
  }, [blocks])
  const remainingByKey = useMemo<Record<string, number>>(() => {
    const rem: Record<string, number> = {}
    subjects.forEach((s) => (rem[s.key] = (requiredByKey[s.key] || 0) - (scheduledByKey[s.key] || 0)))
    return rem
  }, [subjects, requiredByKey, scheduledByKey])

  // ===== Normalisation / Validation AI =====
  const DAY_NAME_TO_KEY: Record<string, DayKey> = {
    lundi: "Mon",
    monday: "Mon",
    mon: "Mon",
    mardi: "Tue",
    tuesday: "Tue",
    tue: "Tue",
    mercredi: "Wed",
    wednesday: "Wed",
    wed: "Wed",
    jeudi: "Thu",
    thursday: "Thu",
    thu: "Thu",
    vendredi: "Fri",
    friday: "Fri",
    fri: "Fri",
  }

  function stripAccentsLower(s: string) {
    return (s || "").normalize("NFD").replace(/\p{Diacritic}+/gu, "").toLowerCase().trim()
  }

  function normalizeDayName(input: string): DayKey | null {
    const v = stripAccentsLower(input)
    const key = DAY_NAME_TO_KEY[v] || (enabledDays.some((d) => stripAccentsLower(d.key) === v) ? (input as DayKey) : null)
    return key
  }

  function normalizeSubjectKey(input: string): string {
    if (!input) return "autre"
    const v = stripAccentsLower(input)
    // direct key match
    if (subjects.some((s) => s.key === input)) return input
    // label match
    const byLabel = subjects.find((s) => stripAccentsLower(s.label) === v)
    if (byLabel) return byLabel.key
    return subjects[0]?.key || "autre"
  }

  function normalizeHHMM(t: string): string {
    if (!t) return "00:00"
    const m = String(t).match(/(\d{1,2})\s*[:hH]\s*(\d{2})/)
    if (m) {
      const h = Math.max(0, Math.min(23, parseInt(m[1], 10)))
      const mi = Math.max(0, Math.min(59, parseInt(m[2], 10)))
      return `${h}:${mi.toString().padStart(2, "0")}`
    }
    // If only hour provided like "8" or "08", assume :00
    const hOnly = String(t).match(/^(\d{1,2})$/)
    if (hOnly) {
      const h = Math.max(0, Math.min(23, parseInt(hOnly[1], 10)))
      return `${h}:00`
    }
    return t
  }

  function postProcessAIBlocks(
    aiBlocks: Array<{ day: string; subject: string; start: string; end: string; subtitle?: string }>,
    baseBlocks: Array<Block> = []
  ) {
    const accepted: Block[] = []
    const dropped: Array<{ block: NewBlock; reason: string }> = []

    for (const b of aiBlocks || []) {
      const dayKey = normalizeDayName(b.day) || DAY_NAME_TO_KEY[stripAccentsLower(b.day)] || b.day
      const subjectKey = normalizeSubjectKey(b.subject)
      const start = normalizeHHMM(b.start)
      const end = normalizeHHMM(b.end)
      const nb: NewBlock = { day: dayKey as DayKey, subject: subjectKey, start, end, subtitle: b.subtitle || "" }

      // Validate against current timetable rules
      const err = blockConflict(nb)
      if (err) {
        dropped.push({ block: nb, reason: err })
        continue
      }
      accepted.push({
        ...nb,
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      })
    }

    if (dropped.length) {
      console.log("[v0] Dropped AI blocks:", dropped)
    }
    return accepted
  }

  // =====  // Charger les sauvegardes au démarrage
  useEffect(() => {
    async function loadSaves() {
      try {
        const saves = await loadTimetables()
        setSavedTimetables(saves)
      } catch (error) {
        console.error('Erreur lors du chargement des sauvegardes:', error)
      }
    }
    loadSaves()
  }, [])

  // Fonctions pour gérer les sauvegardes
  async function doSave() {
    if (!saveName.trim()) {
      alert('Veuillez entrer un nom pour la sauvegarde')
      return
    }
    
    // Vérifier si le nom existe déjà
    const existingNames = savedTimetables.map(save => save.name.toLowerCase())
    if (existingNames.includes(saveName.trim().toLowerCase())) {
      alert('La sauvegarde existe déjà, choisissez un autre nom')
      return
    }
    
    setSaving(true)
    try {
      const saveData = {
        name: saveName.trim(),
        class_name: klass,
        days_config: days,
        blocks: blocks,
        subjects: subjects
      }
      
      await saveTimetable(saveData)
      
      // Recharger la liste des sauvegardes
      const saves = await loadTimetables()
      setSavedTimetables(saves)
      
      setShowSaveDialog(false)
      setSaveName('')
      alert('Emploi du temps sauvegardé avec succès !')
    } catch (error) {
      console.error('Erreur lors de la sauvegarde:', error)
      alert('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  async function loadSave(save: TimetableSave) {
    try {
      // Validate incoming data
      const parsed = zTimetableSave.safeParse(save)
      if (!parsed.success) {
        console.error('[v0] Invalid save payload:', parsed.error.flatten())
        alert('Format de sauvegarde invalide. Impossible de charger cet emploi du temps.')
        return
      }
      const data = parsed.data
      // Restore data
      setKlass(data.class_name)
      setDays(data.days_config)
      setBlocks(data.blocks)
      setCustomSubjects(data.subjects)
      
      alert(`Emploi du temps "${data.name}" chargé avec succès !`)
    } catch (error) {
      console.error('Erreur lors du chargement:', error)
      alert('Erreur lors du chargement')
    }
  }

  async function deleteSave(id: string, name: string) {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${name}" ?`)) {
      return
    }
    
    try {
      await deleteTimetable(id)
      const saves = await loadTimetables()
      setSavedTimetables(saves)
      alert('Sauvegarde supprimée')
    } catch (error) {
      console.error('Erreur lors de la suppression:', error)
      alert('Erreur lors de la suppression')
    }
  }

  // ===== Fonctions horaires =====
  function getRecessIntervals(dayObj: DayConfig) {
    const r1s = toMin(dayObj.rec1Start),
      r1e = r1s + (dayObj.rec1Dur || 0)
    const r2s = toMin(dayObj.rec2Start),
      r2e = r2s + (dayObj.rec2Dur || 0)
    return [
      [r1s, r1e],
      [r2s, r2e],
    ]
  }
  function getTeachingIntervals(dayObj: DayConfig) {
    const ms = toMin(dayObj.morningStart),
      ls = toMin(dayObj.lunchStart)
    const le = toMin(dayObj.lunchEnd),
      de = toMin(dayObj.dayEnd)
    const arr = []
    if (ms < ls) arr.push([ms, ls])
    if (le < de) arr.push([le, de])
    return arr
  }
  function touchesRecess(dayObj: DayConfig, s: number, e: number) {
    return getRecessIntervals(dayObj).some(([rs, re]) => overlaps(s, e, rs, re))
  }
  function isInsideTeaching(dayObj: DayConfig, s: number, e: number) {
    return getTeachingIntervals(dayObj).some(([ts, te]) => ts <= s && e <= te)
  }

  // Autoriser les blocs pendant la cantine et les récrés: on ne garde que les bornes de la journée
  function isInsideDay(dayObj: DayConfig, s: number, e: number) {
    const ms = toMin(dayObj.morningStart)
    const de = toMin(dayObj.dayEnd)
    return ms <= s && e <= de
  }

  function blockConflict(newBlock: NewBlock | Block, ignoreId: string | null = null) {
    const d = dayMap[newBlock.day]
    if (!d || !d.enabled) return "Jour désactivé."
    const s = toMin(newBlock.start),
      e = toMin(newBlock.end)
    if (e <= s) return "Fin avant début."
    // Autoriser chevauchements et cantine/récrés, ne garder que bornes de journée
    if (!isInsideDay(d, s, e)) return "Hors des bornes de la journée."
    return null
  }

  function strictlyOverlapsRecess(day: DayConfig, start: number, end: number) {
    // Utilise les mêmes champs que le reste du code (rec1Start/rec1Dur, rec2Start/rec2Dur)
    const r1Start = toMin(day.rec1Start)
    const r1End = r1Start + (day.rec1Dur || 0)
    const r2Start = toMin(day.rec2Start)
    const r2End = r2Start + (day.rec2Dur || 0)

    // Permettre le contact (juste avant ou après) mais pas le chevauchement
    return (
      (start < r1End && end > r1Start && !(end === r1Start || start === r1End)) ||
      (start < r2End && end > r2Start && !(end === r2Start || start === r2End))
    )
  }

  function addBlock(b: NewBlock): boolean {
    const err = blockConflict(b)
    if (err) {
      // Essayer de trouver un créneau proche valide
      const duration = toMin(b.end) - toMin(b.start)
      const validStart = findNearestValidStart(b.day, toMin(b.start), duration)
      if (validStart !== null) {
        const adjustedBlock: NewBlock = {
          ...b,
          start: toHHMM(validStart),
          end: toHHMM(validStart + duration)
        }
        setBlocks((prev) => [
          ...prev,
          {
            ...adjustedBlock,
            subtitle: adjustedBlock.subtitle || "",
            id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          },
        ])
        return true
      } else {
        alert(`Impossible de placer le bloc: ${err}`)
        return false
      }
    }
    setBlocks((prev) => [
      ...prev,
      {
        ...b,
        subtitle: b.subtitle || "",
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
    ])
    return true
  }
  function updateBlock(id: string, patch: Partial<Omit<Block, "id">>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id))

  // Function to duplicate a block to an adjacent day
  const duplicateBlockToAdjacentDay = (block: Block, direction: 'left' | 'right') => {
    const currentDayIndex = enabledDays.findIndex(d => d.key === block.day)
    if (currentDayIndex === -1) return
    const targetDayIndex = currentDayIndex + (direction === 'left' ? -1 : 1)
    // Check if target day exists
    if (targetDayIndex < 0 || targetDayIndex >= enabledDays.length) {
      return
    }
    
    const targetDay = enabledDays[targetDayIndex].key
    
    // Create new block with same properties but different day and new ID
    const newBlock: Block = {
      ...block,
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      day: targetDay
    }
    
    // Check for conflicts in target day
    const conflict = blockConflict(newBlock)
    if (!conflict) {
      setBlocks(prev => [...prev, newBlock])
    } else {
      console.log('Cannot duplicate block: conflict detected', conflict)
    }
  }

  // ===== Trouver un créneau valide proche (utile au drop) =====
  function findNearestValidStart(dayKey: DayKey, baseStartMin: number, duration = 60) {
    const d = dayMap[dayKey]
    if (!d) return null
    const dayStart = toMin(d.morningStart)
    const dayEnd = toMin(d.dayEnd)
    const tried = new Set<number>()
    for (let delta = 0; delta <= 240; delta += SNAP_MIN) {
      const candidates = delta === 0 ? [baseStartMin] : [baseStartMin + delta, baseStartMin - delta]
      for (const s of candidates) {
        if (tried.has(s)) continue
        tried.add(s)
        const e = s + duration
        // Valide si dans les bornes de la journée uniquement
        if (s < dayStart || e > dayEnd) continue
        const tmp: NewBlock = { day: dayKey, start: toHHMM(s), end: toHHMM(e), subject: subjects[0].key }
        const err = blockConflict(tmp)
        if (!err) return s
      }
    }
    return null
  }

  function BlockRnd({ block, zoneStart, zoneEnd, lunchStartMin, lunchEndMin }: { block: Block; zoneStart: number; zoneEnd: number; lunchStartMin: number; lunchEndMin: number }) {
    const { id, subject } = block
    const color = SUBJECT_COLORS[subject] || SUBJECT_COLORS.autre
    const s = toMin(block.start),
      e = toMin(block.end)
    const top = timeToY(s, zoneStart, lunchStartMin, lunchEndMin)
    const height = Math.max(60, timeToY(e, zoneStart, lunchStartMin, lunchEndMin) - timeToY(s, zoneStart, lunchStartMin, lunchEndMin))

    return (
      <Rnd
        bounds="parent"
        cancel=".no-drag"
        enableResizing={{
          top: true,
          bottom: true,
          left: false,
          right: false,
          topLeft: false,
          topRight: false,
          bottomLeft: false,
          bottomRight: false,
        }}
        size={{ width: "100%", height }}
        position={{ x: 0, y: top }}
        onDragStop={(e, d) => {
          const rawStart = yToTime(d.y, zoneStart, lunchStartMin, lunchEndMin)
          let newStart = Math.round(rawStart / SNAP_MIN) * SNAP_MIN
          // clamp in bounds
          newStart = Math.max(zoneStart, Math.min(newStart, zoneEnd - SNAP_MIN))
          const duration = toMin(block.end) - toMin(block.start)
          const newEnd = Math.min(zoneEnd, newStart + duration)
          const newBlock = { ...block, start: toHHMM(newStart), end: toHHMM(newEnd) }
          const err = blockConflict(newBlock, id)
          if (!err) {
            updateBlock(id, { start: newBlock.start, end: newBlock.end })
          } else {
            // Ne pas bloquer complètement, essayer de trouver une position proche valide
            const validStart = findNearestValidStart(block.day, newStart, duration)
            if (validStart !== null) {
              updateBlock(id, { start: toHHMM(validStart), end: toHHMM(validStart + duration) })
            } else {
              console.log("[v0] Drag conflict:", err)
            }
          }
        }}
        onResizeStop={(e, direction, ref, delta, position) => {
          const newHeight = Number.parseInt(ref.style.height)
          const yTop = position.y
          const yBottom = position.y + newHeight
          let newStart = Math.round(yToTime(yTop, zoneStart, lunchStartMin, lunchEndMin) / SNAP_MIN) * SNAP_MIN
          let newEnd = Math.round(yToTime(yBottom, zoneStart, lunchStartMin, lunchEndMin) / SNAP_MIN) * SNAP_MIN
          if (newEnd <= newStart) newEnd = newStart + SNAP_MIN
          // clamp in bounds
          newStart = Math.max(zoneStart, newStart)
          newEnd = Math.min(zoneEnd, newEnd)
          const newDuration = Math.max(SNAP_MIN, newEnd - newStart)
          const newBlock = { ...block, start: toHHMM(newStart), end: toHHMM(newEnd) }
          const err = blockConflict(newBlock, id)
          if (!err) {
            updateBlock(id, { start: newBlock.start, end: newBlock.end })
          } else {
            // Essayer de garder au moins la durée minimale
            const validStart = findNearestValidStart(block.day, newStart, newDuration)
            if (validStart !== null) {
              updateBlock(id, { start: toHHMM(validStart), end: toHHMM(validStart + newDuration) })
            } else {
              console.log("[v0] Resize conflict:", err)
            }
          }
        }}
        dragGrid={[1, 1]}
        resizeGrid={[1, 1]}
        className={`${color} border-2 rounded-lg shadow-sm cursor-move overflow-hidden relative`}
      >
        <div className="p-2 h-full flex">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm text-gray-900 truncate">
              {subjects.find((s) => s.key === subject)?.label || subject}
            </div>
            <div className="text-xs text-gray-600 mt-1">
              {toHHMM(toMin(block.start))} - {toHHMM(toMin(block.end))} (
              {minutesToHM(toMin(block.end) - toMin(block.start))})
            </div>
            {block.subtitle && <div className="text-xs text-gray-500 truncate mt-2">{block.subtitle}</div>}
          </div>
          <div className="flex flex-col gap-1 no-drag">
            {/* Drag handle for horizontal move between days */}
            <button
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData("application/edt-block", String(id))
                try { ev.dataTransfer.effectAllowed = "move" } catch {}
              }}
              className="w-6 h-6 bg-gray-700 hover:bg-gray-800 text-white rounded text-xs flex items-center justify-center transition-colors cursor-grab"
              title="Déplacer horizontalement (vers un autre jour)"
            >
              ↔
            </button>
            {/* Arrow buttons for duplicating to adjacent columns */}
            <div className="flex gap-1">
              {/* Left arrow - only show if there's a column to the left */}
              {enabledDays.findIndex(d => d.key === block.day) > 0 && (
                <button
                  onClick={() => duplicateBlockToAdjacentDay(block, 'left')}
                  className="w-5 h-5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs flex items-center justify-center transition-colors"
                  title="Dupliquer à gauche"
                >
                  ←
                </button>
              )}
              {/* Right arrow - only show if there's a column to the right */}
              {enabledDays.findIndex(d => d.key === block.day) < enabledDays.length - 1 && (
                <button
                  onClick={() => duplicateBlockToAdjacentDay(block, 'right')}
                  className="w-5 h-5 bg-gray-500 hover:bg-gray-600 text-white rounded text-xs flex items-center justify-center transition-colors"
                  title="Dupliquer à droite"
                >
                  →
                </button>
              )}
            </div>
            <button
              onClick={() => setEditingBlock(block)}
              className="w-6 h-6 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs flex items-center justify-center transition-colors"
              title="Éditer"
            >
              ✏️
            </button>
            <button
              onClick={() => removeBlock(id)}
              className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded text-xs flex items-center justify-center transition-colors"
              title="Supprimer"
            >
              🗑️
            </button>
          </div>
        </div>
      </Rnd>
    )
  }

  // ======= Auto-fill function =======
  const doAutoFill = async () => {
    console.log("[v0] doAutoFill called")
    if (!process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
      alert("Clé API OpenAI manquante. Ajoutez NEXT_PUBLIC_OPENAI_API_KEY dans .env.local puis relancez.")
      return
    }
    if (exporting) {
      console.log("[v0] doAutoFill ignored: already exporting")
      return
    }
    // Confirmation supprimée (l'iframe de preview peut la bloquer). Lancement direct.
    console.log("[v0] Starting AI generation (no confirm), clearing blocks")
    setBlocks([])
    setExporting(true)

    try {
      const subjectList = subjects
        .map((s) => `${s.key}: "${s.label}" (${minutesToHM(s.minutes)})`)
        .join(", ")

      const d0 = dayMap[enabledDays[0].key]
      const r1End = toHHMM(toMin(d0.rec1Start) + (d0.rec1Dur || 0))
      const r2End = toHHMM(toMin(d0.rec2Start) + (d0.rec2Dur || 0))
      const prompt = `Tu es un expert en pédagogie française. Crée un emploi du temps optimal pour une classe de ${klass} (${cycle}).

CONTRAINTES OBLIGATOIRES :
- Respecter exactement les volumes horaires : ${subjectList}
- Jours d'école (clés à utiliser): ${enabledDays.map((d) => d.key).join(", ")}
- Horaires : ${d0.morningStart} - ${d0.dayEnd}
- Récréations : ${d0.rec1Start}-${r1End} et ${d0.rec2Start}-${r2End}
- Cantine : ${d0.lunchStart}-${d0.lunchEnd}

IMPORTANT :
- Utilise EXACTEMENT ces clés de matières: ${subjects.map((s) => s.key).join(", ")}
- Utilise EXACTEMENT ces clés de jours: ${enabledDays.map((d) => d.key).join(", ")}

BONNES PRATIQUES :
- Français le matin (concentration maximale)
- EPS après la cantine ou en fin de journée
- Alternance matières intellectuelles/physiques
- Mathématiques quand les enfants sont concentrés
- Arts en fin de journée possible

FORMAT DE SORTIE STRICT:
{
  "blocks": [
    { "day": "Mon", "subject": "fr", "start": "08:30", "end": "09:30", "subtitle": "" }
  ]
}

Génère un emploi du temps complet et équilibré.`

      console.log("[v0] Calling OpenAI API with prompt:", prompt)

      const result = await withTimeout(
        generateObject({
          model: openaiClient("gpt-4o"),
          prompt,
          schema: z.object({
            blocks: z.array(
              z.object({
                day: z.string(),
                subject: z.string(),
                start: z.string(),
                end: z.string(),
                subtitle: z.string().optional().default(""),
              }),
            ),
          }),
        }),
        45000,
      )

      console.log("[v0] AI response received:", JSON.stringify(result.object))

      const processed = postProcessAIBlocks((result as any).object.blocks)

      console.log("[v0] Setting new blocks:", processed)
      setBlocks(processed)
    } catch (error) {
      console.error("[v0] AI generation failed:", error)
      if ((error as any)?.message === "timeout") {
        alert("Temps d'attente dépassé pour la génération. Réessayez dans un instant.")
      } else {
        alert(
          "Erreur lors de la génération automatique. Vérifiez que votre clé API OpenAI est configurée dans les paramètres du projet.",
        )
      }
    } finally {
      setExporting(false)
    }
  }

  const doSmartAutoFill = async () => {
    console.log("[v0] doSmartAutoFill called")
    if (!process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
      alert("Clé API OpenAI manquante. Ajoutez NEXT_PUBLIC_OPENAI_API_KEY dans .env.local puis relancez.")
      return
    }
    if (exporting) {
      console.log("[v0] doSmartAutoFill ignored: already exporting")
      return
    }
    setExporting(true)

    try {
      const existingBlocks = blocks.filter((b) => !["Récréation", "Déjeuner"].includes(b.subject))
      const occupiedSlots = existingBlocks.map((b) => `${b.day} ${b.start}-${b.end}: ${b.subject}`).join(", ")

      const subjectList = subjects
        .map((s) => `${s.key}: "${s.label}" (${minutesToHM(s.minutes)})`)
        .join(", ")

      const d1 = dayMap[enabledDays[0].key]
      const d1r1End = toHHMM(toMin(d1.rec1Start) + (d1.rec1Dur || 0))
      const d1r2End = toHHMM(toMin(d1.rec2Start) + (d1.rec2Dur || 0))
      const prompt = `Tu es un expert en pédagogie française. Complète intelligemment cet emploi du temps de ${klass} (${cycle}).

CRÉNEAUX DÉJÀ OCCUPÉS : ${occupiedSlots || "Aucun"}

CONTRAINTES :
- Respecter les volumes horaires : ${subjectList}
- Jours (clés à utiliser) : ${enabledDays.map((d) => d.key).join(", ")}
- Horaires : ${d1.morningStart} - ${d1.dayEnd}
- Récréations : ${d1.rec1Start}-${d1r1End} et ${d1.rec2Start}-${d1r2End}
- Cantine : ${d1.lunchStart}-${d1.lunchEnd}

IMPORTANT : 
- Utilise EXACTEMENT ces clés de matières: ${subjects.map((s) => s.key).join(", ")}
- Utilise EXACTEMENT ces clés de jours: ${enabledDays.map((d) => d.key).join(", ")}
- NE PAS modifier les créneaux existants
- Remplir seulement les espaces libres
- Respecter les bonnes pratiques pédagogiques

FORMAT DE SORTIE STRICT:
{
  "blocks": [
    { "day": "Mon", "subject": "maths", "start": "10:30", "end": "11:15", "subtitle": "" }
  ]
}

Génère UNIQUEMENT les nouveaux créneaux à ajouter.`

      console.log("[v0] Calling OpenAI API for smart fill with prompt:", prompt)

      const result = await withTimeout(
        generateObject({
          model: openaiClient("gpt-4o"),
          prompt,
          schema: z.object({
            blocks: z.array(
              z.object({
                day: z.string(),
                subject: z.string(),
                start: z.string(),
                end: z.string(),
                subtitle: z.string().optional().default(""),
              }),
            ),
          }),
        }),
        45000,
      )

      console.log("[v0] Smart fill AI response received:", JSON.stringify(result.object))

      const processed = postProcessAIBlocks((result as any).object.blocks, blocks)

      console.log("[v0] Adding smart fill blocks:", processed)
      setBlocks((prev) => [...prev, ...processed])
    } catch (error) {
      console.error("[v0] Smart fill failed:", error)
      if ((error as any)?.message === "timeout") {
        alert("Temps d'attente dépassé pour le remplissage intelligent. Réessayez dans un instant.")
      } else {
        alert(
          "Erreur lors du remplissage intelligent. Vérifiez que votre clé API OpenAI est configurée dans les paramètres du projet.",
        )
      }
    } finally {
      setExporting(false)
    }
  }

  function doClearAll() {
    if (confirm("Vider complètement l'emploi du temps ?")) {
      setBlocks([])
    }
  }

  // ===== Export PDF =====
  async function doExport() {
    console.log("[v0] doExport called, exportTitle:", exportTitle)
    
    // Utiliser un titre par défaut si vide
    const finalTitle = exportTitle.trim() || `Emploi_du_temps_${klass}_${new Date().toISOString().split('T')[0]}`
    
    console.log("[v0] Final title:", finalTitle)
    console.log("[v0] exportRef.current:", exportRef.current)
    console.log("[v0] summaryRef.current:", summaryRef.current)
    
    setExporting(true)
    try {
      const pdf = new jsPDF("landscape", "mm", "a4")

      // Export main timetable (mode couleur avec secours automatique)
      if (exportRef.current) {
        console.log("[v0] Rasterizing main timetable (color mode with fallback)...")
        const canvas = await rasterizeWithFallback(exportRef.current)
        const imgData = canvas.toDataURL("image/png")
        
        // Calculer les dimensions pour s'adapter à la page A4 paysage
        const pageWidth = 297 // A4 paysage en mm
        const pageHeight = 210
        const margin = 15
        const maxWidth = pageWidth - (margin * 2)
        const maxHeight = pageHeight - (margin * 2) - 20 // Espace pour titre
        
        // Calculer le ratio pour s'adapter
        const widthRatio = maxWidth / (canvas.width / 2) // Diviser par 2 car échelle 1.5x
        const heightRatio = maxHeight / (canvas.height / 2)
        const ratio = Math.min(widthRatio, heightRatio, 1) // Ne pas agrandir
        
        const imgWidth = (canvas.width / 2) * ratio
        const imgHeight = (canvas.height / 2) * ratio
        
        // Centrer l'image
        const x = (pageWidth - imgWidth) / 2
        const y = margin + 10
        
        console.log(`[v0] Timetable: ${canvas.width}x${canvas.height} -> ${imgWidth.toFixed(1)}x${imgHeight.toFixed(1)} mm`)
        pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight)
        console.log("[v0] Main timetable added to PDF")
      } else {
        console.warn("[v0] exportRef.current is null")
      }

      // Export summary on new page (mode couleur avec secours automatique)
      if (summaryRef.current) {
        console.log("[v0] Rasterizing summary (color mode with fallback)...")
        pdf.addPage()
        const canvas = await rasterizeWithFallback(summaryRef.current)
        const imgData = canvas.toDataURL("image/png")
        
        // Calculer les dimensions pour le résumé
        const pageWidth = 297
        const pageHeight = 210
        const margin = 15
        const maxWidth = pageWidth - (margin * 2)
        const maxHeight = pageHeight - (margin * 2) - 10
        
        const widthRatio = maxWidth / (canvas.width / 2)
        const heightRatio = maxHeight / (canvas.height / 2)
        const ratio = Math.min(widthRatio, heightRatio, 1)
        
        const imgWidth = (canvas.width / 2) * ratio
        const imgHeight = (canvas.height / 2) * ratio
        
        const x = (pageWidth - imgWidth) / 2
        const y = margin + 5
        
        console.log(`[v0] Summary: ${canvas.width}x${canvas.height} -> ${imgWidth.toFixed(1)}x${imgHeight.toFixed(1)} mm`)
        pdf.addImage(imgData, "PNG", x, y, imgWidth, imgHeight)
        console.log("[v0] Summary added to PDF")
      } else {
        console.warn("[v0] summaryRef.current is null")
      }

      console.log("[v0] Saving PDF as:", `${finalTitle}.pdf`)
      pdf.save(`${finalTitle}.pdf`)
      console.log("[v0] PDF export completed successfully")
    } catch (err) {
      console.error("[v0] Erreur export PDF:", err)
      const errorMessage = err instanceof Error ? err.message : String(err)
      alert(`Erreur lors de l'export PDF: ${errorMessage}`)
    } finally {
      setExporting(false)
    }
  }

  // ===== Render =====
  if (step === 1) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-amber-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">📚 Générateur d'Emploi du Temps</h1>
            <p className="text-gray-600">Configuration des horaires scolaires</p>
          </div>

          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold mb-4 text-center">Sélection de la classe</h2>
            <div className="flex justify-center">
              <select
                value={klass}
                onChange={(e) => {
                  const v = e.target.value
                  if (isKlass(v)) setKlass(v)
                }}
                className="p-3 rounded-lg border-2 border-gray-300 focus:border-cyan-500 text-lg min-w-[200px]"
              >
                <option value="CP">CP (Cycle 2)</option>
                <option value="CE1">CE1 (Cycle 2)</option>
                <option value="CE2">CE2 (Cycle 2)</option>
                <option value="CM1">CM1 (Cycle 3)</option>
                <option value="CM2">CM2 (Cycle 3)</option>
              </select>
            </div>
            <div className="flex justify-center mt-4">
              <button
                onClick={() => {
                  // ouvrir l'éditeur avec une copie des matières actuelles
                  try {
                    setEditSubjects(JSON.parse(JSON.stringify(subjects)))
                  } catch {
                    setEditSubjects(subjects.map((s: any) => ({ ...s })))
                  }
                  setShowCustomize(true)
                }}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
              >
                Personnaliser matières
              </button>
            </div>
          </div>

          {showCustomize && (
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Personnaliser matières & volumes</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditSubjects(((SUBJECTS as any)[cycle] as any[]).map((s: any) => ({ ...s })))}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Réinitialiser {cycle}
                  </button>
                  <button
                    onClick={() =>
                      setEditSubjects((prev) => [
                        ...prev,
                        { key: `autre_${prev.length + 1}` , label: "Nouvelle matière", minutes: 60 },
                      ])
                    }
                    className="px-3 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900"
                  >
                    Ajouter une matière
                  </button>
                  <button
                    onClick={() => {
                      // Validation: clés uniques et champs non vides
                      const cleaned = editSubjects.map((s: any) => ({
                        ...s,
                        label: (s.label || "").trim(),
                        key: (s.key || "").trim(),
                        minutes: Math.max(0, Number(s.minutes || 0)),
                      }))
                      if (cleaned.some((s: any) => !s.label || !s.key)) {
                        alert("Chaque matière doit avoir un libellé et une clé non vides.")
                        return
                      }
                      const seen = new Set<string>()
                      for (const s of cleaned) {
                        if (seen.has(s.key)) {
                          alert(`Clé de matière en double: ${s.key}`)
                          return
                        }
                        seen.add(s.key)
                      }
                      setCustomSubjects(cleaned)
                      setShowCustomize(false)
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Appliquer
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-2 w-8"></th>
                      <th className="py-2 pr-4">Libellé</th>
                      <th className="py-2 pr-4">Clé</th>
                      <th className="py-2 pr-4">Heures</th>
                      <th className="py-2 pr-4">Minutes</th>
                      <th className="py-2 pr-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editSubjects.map((s, idx) => {
                      const h = Math.floor((s.minutes || 0) / 60)
                      const m = (s.minutes || 0) % 60
                      return (
                        <tr key={idx} className="border-t">
                          <td className="py-2 pr-2 w-8">
                            <button
                              onClick={() => {
                                const arr = [...editSubjects]
                                arr.splice(idx, 1)
                                setEditSubjects(arr)
                              }}
                              className="w-6 h-6 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center"
                              title="Supprimer"
                              aria-label="Supprimer la matière"
                            >
                              -
                            </button>
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              value={s.label}
                              onChange={(e) => {
                                const arr = [...editSubjects]
                                arr[idx] = { ...arr[idx], label: e.target.value }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              value={s.key}
                              onChange={(e) => {
                                const arr = [...editSubjects]
                                arr[idx] = { ...arr[idx], key: e.target.value }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 w-28">
                            <input
                              type="number"
                              min={0}
                              value={h}
                              onChange={(e) => {
                                const nh = Math.max(0, parseInt(e.target.value || "0", 10))
                                const arr = [...editSubjects]
                                const minutes = nh * 60 + ((arr[idx].minutes || 0) % 60)
                                arr[idx] = { ...arr[idx], minutes }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 w-28">
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={m}
                              onChange={(e) => {
                                const nm = Math.max(0, Math.min(59, parseInt(e.target.value || "0", 10)))
                                const arr = [...editSubjects]
                                const minutes = Math.floor((arr[idx].minutes || 0) / 60) * 60 + nm
                                arr[idx] = { ...arr[idx], minutes }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 text-gray-700">{minutesToHM(s.minutes || 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <h2 className="text-2xl font-semibold mb-6 text-center">Configuration des jours d'école</h2>
            <div className="flex justify-end -mt-2 mb-4">
              <button
                onClick={copyMondayToOthers}
                className="px-3 py-2 rounded-md bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-medium shadow"
              >
                Mêmes horaires que le lundi
              </button>
            </div>
            <div className="space-y-6">
              {days.map((day: any, i: number) => (
                <div key={i} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <label className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={day.enabled}
                        onChange={(e) => {
                          const newDays = [...days]
                          newDays[i].enabled = e.target.checked
                          setDays(newDays)
                        }}
                        className="w-5 h-5 text-cyan-600"
                      />
                      <span className="text-xl font-medium">{day.label}</span>
                    </label>
                  </div>

                  {day.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">Début matin</label>
                        <input
                          type="time"
                          value={day.morningStart}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].morningStart = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Fin journée</label>
                        <input
                          type="time"
                          value={day.dayEnd}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].dayEnd = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Début cantine</label>
                        <input
                          type="time"
                          value={day.lunchStart}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].lunchStart = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Fin cantine</label>
                        <input
                          type="time"
                          value={day.lunchEnd}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].lunchEnd = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Récréation 1</label>
                        <input
                          type="time"
                          value={day.rec1Start}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].rec1Start = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Durée récré 1 (min)</label>
                        <input
                          type="number"
                          value={day.rec1Dur}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].rec1Dur = Number.parseInt(e.target.value)
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                          min="5"
                          max="30"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Récréation 2</label>
                        <input
                          type="time"
                          value={day.rec2Start}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].rec2Start = e.target.value
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Durée récré 2 (min)</label>
                        <input
                          type="number"
                          value={day.rec2Dur}
                          onChange={(e) => {
                            const newDays = [...days]
                            newDays[i].rec2Dur = Number.parseInt(e.target.value)
                            setDays(newDays)
                          }}
                          className="w-full p-2 border rounded-lg"
                          min="5"
                          max="30"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="text-center">
            <button
              onClick={() => setStep(2)}
              className="px-8 py-4 rounded-lg bg-gradient-to-r from-cyan-500 to-amber-500 text-white font-semibold hover:from-cyan-600 hover:to-amber-600 transition-all transform hover:scale-105 shadow-lg"
            >
              Créer l'emploi du temps →
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (step === 2) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-cyan-50 to-amber-50 p-4">
        <div className="max-w-7xl mx-auto">
          {/* Header with buttons */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-8 p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-cyan-200">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-600 to-amber-600 bg-clip-text text-transparent">
              📅 Emploi du temps - {klass}
            </h1>
            <button
              onClick={doClearAll}
              disabled={exporting}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold hover:from-red-600 hover:to-red-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50"
            >
              🗑️ Vider tout
            </button>
            <button
              onClick={doSmartAutoFill}
              disabled={exporting}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50"
            >
              {exporting ? "⏳ Génération..." : "✨ Compléter auto"}
            </button>
            <button
              onClick={doAutoFill}
              disabled={exporting}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-purple-600 text-white font-semibold hover:from-purple-600 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50"
            >
              {exporting ? "⏳ Génération..." : "🤖 Remplir auto"}
            </button>
            <button
              onClick={() => {
                try {
                  setEditSubjects(JSON.parse(JSON.stringify(subjects)))
                } catch {
                  setEditSubjects(subjects.map((s: any) => ({ ...s })))
                }
                setShowCustomize(true)
              }}
              className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors shadow-lg"
            >
              🎛️ Personnaliser matières
            </button>
            <button
              onClick={() => setShowSaveDialog(true)}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-semibold hover:from-cyan-600 hover:to-cyan-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50"
            >
              {saving ? "💾 Sauvegarde..." : "💾 Sauvegarder"}
            </button>
            <button
              onClick={() => setStep(3)}
              className="px-6 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              📊 Exporter PDF
            </button>
          </div>

          {showCustomize && (
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Personnaliser matières & volumes</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditSubjects(((SUBJECTS as any)[cycle] as any[]).map((s: any) => ({ ...s })))}
                    className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800"
                  >
                    Réinitialiser {cycle}
                  </button>
                  <button
                    onClick={() =>
                      setEditSubjects((prev) => [
                        ...prev,
                        { key: `autre_${prev.length + 1}` , label: "Nouvelle matière", minutes: 60 },
                      ])
                    }
                    className="px-3 py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900"
                  >
                    Ajouter une matière
                  </button>
                  <button
                    onClick={() => {
                      // Validation: clés uniques et champs non vides
                      const cleaned = editSubjects.map((s: any) => ({
                        ...s,
                        label: (s.label || "").trim(),
                        key: (s.key || "").trim(),
                        minutes: Math.max(0, Number(s.minutes || 0)),
                      }))
                      if (cleaned.some((s: any) => !s.label || !s.key)) {
                        alert("Chaque matière doit avoir un libellé et une clé non vides.")
                        return
                      }
                      const seen = new Set<string>()
                      for (const s of cleaned) {
                        if (seen.has(s.key)) {
                          alert(`Clé de matière en double: ${s.key}`)
                          return
                        }
                        seen.add(s.key)
                      }
                      setCustomSubjects(cleaned)
                      setShowCustomize(false)
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Appliquer
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-2 w-8"></th>
                      <th className="py-2 pr-4">Libellé</th>
                      <th className="py-2 pr-4">Clé</th>
                      <th className="py-2 pr-4">Heures</th>
                      <th className="py-2 pr-4">Minutes</th>
                      <th className="py-2 pr-4">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editSubjects.map((s, idx) => {
                      const h = Math.floor((s.minutes || 0) / 60)
                      const m = (s.minutes || 0) % 60
                      return (
                        <tr key={idx} className="border-t">
                          <td className="py-2 pr-2 w-8">
                            <button
                              onClick={() => {
                                const arr = [...editSubjects]
                                arr.splice(idx, 1)
                                setEditSubjects(arr)
                              }}
                              className="w-6 h-6 rounded-full bg-red-100 text-red-600 hover:bg-red-200 flex items-center justify-center"
                              title="Supprimer"
                              aria-label="Supprimer la matière"
                            >
                              -
                            </button>
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              value={s.label}
                              onChange={(e) => {
                                const arr = [...editSubjects]
                                arr[idx] = { ...arr[idx], label: e.target.value }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              value={s.key}
                              onChange={(e) => {
                                const arr = [...editSubjects]
                                arr[idx] = { ...arr[idx], key: e.target.value }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 w-28">
                            <input
                              type="number"
                              min={0}
                              value={h}
                              onChange={(e) => {
                                const nh = Math.max(0, parseInt(e.target.value || "0", 10))
                                const arr = [...editSubjects]
                                const minutes = nh * 60 + ((arr[idx].minutes || 0) % 60)
                                arr[idx] = { ...arr[idx], minutes }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 w-28">
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={m}
                              onChange={(e) => {
                                const nm = Math.max(0, Math.min(59, parseInt(e.target.value || "0", 10)))
                                const arr = [...editSubjects]
                                const minutes = Math.floor((arr[idx].minutes || 0) / 60) * 60 + nm
                                arr[idx] = { ...arr[idx], minutes }
                                setEditSubjects(arr)
                              }}
                              className="w-full p-2 border rounded-lg"
                            />
                          </td>
                          <td className="py-2 pr-4 text-gray-700">{minutesToHM(s.minutes || 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Subject Panel */}
            <div className="lg:col-span-1">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-cyan-200 p-6">
                <h2 className="text-xl font-bold mb-4 text-gray-800">📚 Matières disponibles</h2>
                <div className="space-y-3">
                  {subjects.map((subject) => {
                    const remaining = remainingByKey[subject.key] || 0
                    const scheduled = scheduledByKey[subject.key] || 0
                    const required = requiredByKey[subject.key] || 0
                    const color = SUBJECT_COLORS[subject.key] || SUBJECT_COLORS.autre

                    return (
                      <div
                        key={subject.key}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", subject.key)
                        }}
                        className={`${color} border-2 rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all duration-200`}
                      >
                        <div className="font-medium text-sm text-gray-900">{subject.label}</div>
                        <div className="text-xs text-gray-600 mt-1">
                          {minutesToHM(scheduled)} / {minutesToHM(required)}
                        </div>
                        {remaining > 0 ? (
                          <div className="text-xs text-red-600 font-medium">Reste: {minutesToHM(remaining)}</div>
                        ) : remaining < 0 ? (
                          <div className="text-xs text-blue-600 font-medium">Dépasse: {minutesToHM(-remaining)}</div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>

                {/* Volume tracking */}
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="text-lg font-semibold mb-3 text-gray-800">📊 Suivi des volumes</h3>
                  <div className="space-y-2">
                    {subjects.map((subject) => {
                      const required = subject.minutes
                      const used = blocks
                        .filter((b) => b.subject === subject.key)
                        .reduce((sum, b) => sum + (toMin(b.end) - toMin(b.start)), 0)
                      const percentage = Math.min(100, Math.round((used / required) * 100))
                      const color = SUBJECT_COLORS[subject.key] || SUBJECT_COLORS.autre

                      return (
                        <div key={subject.key} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-medium">{subject.label}</span>
                            <span>{percentage}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all duration-300 ${SUBJECT_BAR_BG[subject.key] || 'bg-gray-400'}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Timetable Grid */}
            <div className="lg:col-span-3">
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-cyan-200 p-6">
                <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${enabledDays.length}, 1fr)` }}>
                  {enabledDays.map((day) => {
                    const d = dayMap[day.key]
                    const dayStart = toMin(d.morningStart)
                    const dayEnd = toMin(d.dayEnd)
                    const lunchStartMin = toMin(d.lunchStart)
                    const lunchEndMin = toMin(d.lunchEnd)
                    const totalHeight = timeToY(dayEnd, dayStart, lunchStartMin, lunchEndMin)
                    const dayBlocks = blocks.filter((b) => b.day === day.key)

                    return (
                      <div key={day.key} className="flex flex-col">
                        <h3 className="text-lg font-bold text-center mb-4 text-gray-800 bg-gradient-to-r from-cyan-100 to-amber-100 rounded-lg py-2">
                          {day.label}
                        </h3>

                        {/* Time grid */}
                        <div
                          className="relative bg-gray-50 rounded-lg border-2 border-gray-200 overflow-hidden"
                          style={{ height: `${totalHeight}px`, minHeight: "400px" }}
                          onDragEnter={(e) => {
                            e.currentTarget.classList.add('ring-2', 'ring-cyan-400')
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.classList.remove('ring-2', 'ring-cyan-400')
                          }}
                          onDragOver={(e) => {
                            e.preventDefault()
                            try { e.dataTransfer.dropEffect = 'move' } catch {}
                          }}
                          onDrop={(e) => {
                            e.preventDefault()
                            e.currentTarget.classList.remove('ring-2', 'ring-cyan-400')

                            // 1) Déplacement d'un bloc existant entre colonnes
                            const movedBlockId = e.dataTransfer.getData("application/edt-block")
                            if (movedBlockId) {
                              const blockToMove = blocks.find((b) => String(b.id) === movedBlockId)
                              if (!blockToMove) return
                              if (blockToMove.day === day.key) return

                              // Déterminer le nouvel horaire depuis la position de drop (Y), en conservant la durée
                              const rect = e.currentTarget.getBoundingClientRect()
                              const y = e.clientY - rect.top
                              const rawStart = yToTime(y, dayStart, lunchStartMin, lunchEndMin)
                              const snappedStart = Math.round(rawStart / SNAP_MIN) * SNAP_MIN
                              const duration = toMin(blockToMove.end) - toMin(blockToMove.start)
                              const snappedEnd = snappedStart + duration

                              const candidate = {
                                ...blockToMove,
                                day: day.key,
                                start: toHHMM(snappedStart),
                                end: toHHMM(snappedEnd),
                              }
                              const err = blockConflict(candidate, blockToMove.id)
                              if (!err) {
                                // Déplacement avec position verticale définie par le drop
                                updateBlock(blockToMove.id, {
                                  day: day.key,
                                  start: candidate.start,
                                  end: candidate.end,
                                })
                              } else {
                                // Essayer de trouver un créneau proche valide autour de la position de drop
                                const validStart = findNearestValidStart(day.key, snappedStart, duration)
                                if (validStart !== null) {
                                  updateBlock(blockToMove.id, {
                                    day: day.key,
                                    start: toHHMM(validStart),
                                    end: toHHMM(validStart + duration),
                                  })
                                } else {
                                  alert(`Impossible de déplacer le bloc: ${err}`)
                                }
                              }
                              return
                            }

                            // 2) Drop d'une matière depuis la palette (comportement existant)
                            const subjectKey = e.dataTransfer.getData("text/plain")
                            if (!subjectKey) return

                            const rect = e.currentTarget.getBoundingClientRect()
                            const y = e.clientY - rect.top
                            const startMin = Math.round(yToTime(y, dayStart, lunchStartMin, lunchEndMin) / SNAP_MIN) * SNAP_MIN
                            const duration = 60 // Default 1 hour
                            const endMin = startMin + duration

                            const newBlock = {
                              day: day.key,
                              subject: subjectKey,
                              start: toHHMM(startMin),
                              end: toHHMM(endMin),
                              subtitle: "",
                            }

                            const success = addBlock(newBlock)
                            if (success) {
                              console.log(`[v0] Block added successfully: ${subjectKey} ${newBlock.start}-${newBlock.end}`)
                            }
                          }}
                        >
                          {/* Hour lines */}
                          {Array.from({ length: Math.ceil((dayEnd - dayStart) / 60) + 1 }, (_, i) => {
                            const time = dayStart + i * 60
                            const y = timeToY(time, dayStart, lunchStartMin, lunchEndMin)
                            return (
                              <div
                                key={i}
                                className="absolute left-0 right-0 border-t border-gray-300 flex items-center"
                                style={{ top: `${y}px` }}
                              >
                                <span className="text-xs text-gray-500 bg-white px-1 rounded">{toHHMM(time)}</span>
                              </div>
                            )
                          })}

                          {/* Recess blocks */}
                          {getRecessIntervals(d).map(([start, end], i) => {
                            const top = timeToY(start, dayStart, lunchStartMin, lunchEndMin)
                            const height = timeToY(end, dayStart, lunchStartMin, lunchEndMin) - timeToY(start, dayStart, lunchStartMin, lunchEndMin)
                            return (
                              <div
                                key={i}
                                className="absolute left-0 right-0 bg-yellow-200 border border-yellow-400 flex items-center justify-center text-xs font-medium text-yellow-800"
                                style={{ top: `${top}px`, height: `${height}px` }}
                              >
                                🏃 Récré {i + 1}
                              </div>
                            )
                          })}

                          {/* Lunch block */}
                          {(() => {
                            const lunchStart = lunchStartMin
                            const lunchEnd = lunchEndMin
                            const top = timeToY(lunchStart, dayStart, lunchStartMin, lunchEndMin)
                            const height = timeToY(lunchEnd, dayStart, lunchStartMin, lunchEndMin) - timeToY(lunchStart, dayStart, lunchStartMin, lunchEndMin)
                            return (
                              <div
                                className="absolute left-0 right-0 bg-orange-200 border border-orange-400 flex items-center justify-center text-xs font-medium text-orange-800"
                                style={{ top: `${top}px`, height: `${height}px` }}
                              >
                                🍽️ Cantine
                              </div>
                            )
                          })()}

                          {/* Subject blocks */}
                          {dayBlocks.map((block) => (
                            <BlockRnd
                              key={block.id}
                              block={block}
                              zoneStart={dayStart}
                              zoneEnd={dayEnd}
                              lunchStartMin={lunchStartMin}
                              lunchEndMin={lunchEndMin}
                            />
                          ))}

                          {/* Bottom border */}
                          <div
                            className="absolute left-0 right-0 border-t-2 border-gray-400"
                            style={{ top: `${totalHeight}px` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sauvegardes */}
        {savedTimetables.length > 0 && (
          <div className="max-w-7xl mx-auto mt-8 p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-cyan-200">
            <h3 className="text-xl font-semibold mb-4 text-gray-800">📁 Emplois du temps sauvegardés</h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {savedTimetables.map((save) => (
                <div key={save.id} className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-800 truncate">{save.name}</h4>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">{save.class_name}</span>
                  </div>
                  <div className="text-xs text-gray-500 mb-3">
                    {new Date(save.created_at || '').toLocaleDateString('fr-FR')}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadSave(save)}
                      className="flex-1 px-3 py-2 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 transition-colors"
                    >
                      📂 Charger
                    </button>
                    <button
                      onClick={() => deleteSave(save.id!, save.name)}
                      className="px-3 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 transition-colors"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dialog de sauvegarde */}
        {showSaveDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Sauvegarder l'emploi du temps</h3>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Nom de la sauvegarde (ex: EDT CM1 Janvier)"
                className="w-full p-3 border border-gray-300 rounded-lg mb-4"
                onKeyDown={(e) => e.key === 'Enter' && doSave()}
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowSaveDialog(false)
                    setSaveName('')
                  }}
                  className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={doSave}
                  disabled={saving || !saveName.trim()}
                  className="flex-1 px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingBlock && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
              <h2 className="text-2xl font-bold mb-6 text-gray-800">✏️ Éditer le créneau</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Matière</label>
                  <div className="p-3 bg-gray-100 rounded-lg text-gray-800 font-medium">
                    {subjects.find((s) => s.key === editingBlock.subject)?.label || editingBlock.subject}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sous-titre (optionnel)</label>
                  <input
                    type="text"
                    value={editingBlock.subtitle || ""}
                    onChange={(e) => setEditingBlock({ ...editingBlock, subtitle: e.target.value })}
                    placeholder="Ex: Grammaire, Géométrie, Lecture..."
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setEditingBlock(null)}
                  className="flex-1 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => {
                    updateBlock(editingBlock.id, { subtitle: editingBlock.subtitle })
                    setEditingBlock(null)
                  }}
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  Sauvegarder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (step === 3) {
    const template = TEMPLATES.find((t) => t.key === exportTemplate) || TEMPLATES[0]

    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="flex items-center justify-center mb-8">
          <h1 className="text-4xl font-bold mr-4">📄 Export PDF</h1>
          <button
            onClick={() => setStep(2)}
            className="p-4 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors mr-4"
          >
            ← Retour
          </button>
          <button
            onClick={doExport}
            className="p-4 rounded-lg bg-green-500 text-white font-semibold hover:bg-green-600 transition-colors"
          >
            {exporting ? "⏳ Export..." : "📥 Télécharger PDF"}
          </button>
        </div>
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-2xl font-semibold mb-4">Titre de l'emploi du temps</h2>
          <input
            type="text"
            value={exportTitle}
            onChange={(e) => setExportTitle(e.target.value)}
            className="p-2 rounded-lg border-2 w-full"
            placeholder="Ex: Emploi du temps CM1 - 2024/2025"
          />
        </div>
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-2xl font-semibold mb-4">Template</h2>
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => setExportTemplate(t.key)}
              className={`p-2 rounded-lg mb-2 ${
                exportTemplate === t.key ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-800"
              } hover:bg-blue-600 transition-colors`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-2xl font-semibold mb-4">Aperçu</h2>
          <div ref={exportRef} className={`rounded-2xl border ${template.card} ${template.gridBg} p-6 bg-white shadow-lg`} style={{width: '1400px', minHeight: '600px'}}>
            <div className="px-6 py-4 rounded-xl bg-blue-500 text-white mb-4 text-center">
              <h1 className="text-2xl font-bold">{exportTitle || `Emploi du temps - ${klass}`}</h1>
              <h2 className="text-lg font-medium">Classe de {klass} (Cycle {cycle})</h2>
            </div>
            
            {/* Grille horizontale comme l'interface drag & drop */}
            <div className="grid gap-2" style={{gridTemplateColumns: `repeat(${enabledDays.length}, 1fr)`}}>
              {/* En-têtes des jours */}
              {enabledDays.map((day) => (
                <div key={`header-${day.key}`} className="text-center py-2 px-1 bg-cyan-100 rounded-lg font-semibold text-gray-800">
                  {day.label}
                </div>
              ))}
              
              {/* Colonnes des jours avec créneaux */}
              {enabledDays.map((day) => {
                const d = dayMap[day.key]
                const dayStart = toMin(d.morningStart)
                const dayEnd = toMin(d.dayEnd)
                const totalHeight = (dayEnd - dayStart) * 1.8 // 1.8px par minute pour encore plus d'espace
                const dayBlocks = blocks.filter((b) => b.day === day.key)
                
                return (
                  <div key={day.key} className="relative bg-gray-50 rounded-lg border" style={{height: `${Math.max(totalHeight, 400)}px`, minHeight: '400px'}}>
                    {/* Lignes d'heures */}
                    {Array.from({ length: Math.ceil((dayEnd - dayStart) / 60) + 1 }, (_, i) => {
                      const time = dayStart + i * 60
                      const y = (time - dayStart) * 1.8
                      return (
                        <div key={i} className="absolute left-0 right-0 border-t border-gray-300 flex items-center" style={{top: `${y}px`}}>
                          <span className="text-xs text-gray-500 bg-white px-1 rounded" style={{fontSize: '12px'}}>{toHHMM(time)}</span>
                        </div>
                      )
                    })}
                    
                    {/* Blocs récréation */}
                    {getRecessIntervals(d).map(([start, end], i) => {
                      const top = (start - dayStart) * 1.8
                      const height = (end - start) * 1.8
                      return (
                        <div key={i} className="absolute left-0 right-0 bg-yellow-200 border border-yellow-400 flex items-center justify-center text-xs font-medium text-yellow-800" style={{top: `${top}px`, height: `${height}px`, fontSize: '12px'}}>
                          🏃 Récré {i + 1}
                        </div>
                      )
                    })}
                    
                    {/* Bloc Cantine */}
                    {(() => {
                      // Utiliser les horaires de cantine définis dans la configuration
                      const lunchStart = toMin(d.lunchStart || "12:00")
                      const lunchEnd = toMin(d.lunchEnd || "13:00")
                      
                      // Vérifier si la cantine tombe dans les heures de la journée
                      if (lunchStart >= dayStart && lunchEnd <= dayEnd) {
                        const top = (lunchStart - dayStart) * 1.8
                        const height = (lunchEnd - lunchStart) * 1.8
                        
                        return (
                          <div className="absolute left-0 right-0 bg-orange-200 border border-orange-400 flex items-center justify-center text-xs font-medium text-orange-800" style={{top: `${top}px`, height: `${height}px`, fontSize: '12px'}}>
                            🍽️ Cantine
                          </div>
                        )
                      }
                      return null
                    })()}
                    
                    {/* Blocs de cours */}
                    {dayBlocks.map((block) => {
                      const s = toMin(block.start)
                      const e = toMin(block.end)
                      const top = (s - dayStart) * 1.8
                      const height = (e - s) * 1.8
                      const color = SUBJECT_COLORS[block.subject] || SUBJECT_COLORS.autre
                      const subjectLabel = subjects.find((sub) => sub.key === block.subject)?.label || block.subject
                      
                      return (
                        <div key={block.id} className={`absolute left-1 right-1 ${color} border-2 rounded-lg p-2 flex flex-col justify-center text-center`} style={{top: `${top}px`, height: `${height}px`, overflow: 'visible', wordWrap: 'break-word', whiteSpace: 'normal'}}>
                          <div className="font-medium text-gray-900" style={{fontSize: '14px', lineHeight: '1.2', marginBottom: '4px'}}>{subjectLabel}</div>
                          {block.subtitle && <div className="text-gray-700" style={{fontSize: '11px', lineHeight: '1.1', marginBottom: '6px'}}>{block.subtitle}</div>}
                          <div className="text-gray-600" style={{fontSize: '12px', lineHeight: '1.1'}}>
                            {block.start} - {block.end}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center mb-8">
          <h2 className="text-2xl font-semibold mb-4">Récapitulatif des volumes horaires</h2>
          <div ref={summaryRef} className={`rounded-2xl border ${template.card} ${template.gridBg} p-6 bg-white shadow-lg max-w-2xl`}>
            <div className={`px-4 py-3 rounded-xl ${template.header} mb-4 text-center`}>
              <h1 className="text-xl font-bold">Volumes hebdomadaires (sans récré)</h1>
              <h2 className="text-sm font-medium">Classe de {klass} (Cycle {cycle})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3">Matière</th>
                    <th className="text-center py-2 px-3">Requis</th>
                    <th className="text-center py-2 px-3">Planifié</th>
                    <th className="text-center py-2 px-3">Restant</th>
                    <th className="text-center py-2 px-3">%</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((subject) => {
                    const scheduled = scheduledByKey[subject.key] || 0
                    const required = requiredByKey[subject.key] || 0
                    const remaining = Math.max(0, required - scheduled)
                    const percentage = required > 0 ? Math.round((scheduled / required) * 100) : 0
                    const color = SUBJECT_COLORS[subject.key] || SUBJECT_COLORS.autre
                    return (
                      <tr key={subject.key} className={`border-b ${color.replace('border-', 'bg-').replace('-300', '-50')}`}>
                        <td className="py-2 px-3 font-medium">{subject.label}</td>
                        <td className="py-2 px-3 text-center">{minutesToHM(required)}</td>
                        <td className="py-2 px-3 text-center">{minutesToHM(scheduled)}</td>
                        <td className={`py-2 px-3 text-center ${remaining === 0 ? 'text-green-700' : remaining > 0 ? 'text-amber-700' : 'text-red-700'}`}>
                          {minutesToHM(remaining)}
                        </td>
                        <td className={`py-2 px-3 text-center font-medium ${percentage >= 100 ? 'text-green-700' : percentage >= 80 ? 'text-amber-700' : 'text-red-700'}`}>
                          {percentage}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
