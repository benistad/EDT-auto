"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Download, Wand2 } from "lucide-react"
import type { SchoolConfig } from "@/app/page"
import { SubjectPanel } from "@/components/subject-panel"
import { TimetableGrid } from "@/components/timetable-grid"
import { generatePDF } from "@/lib/pdf-generator"

interface TimetableScreenProps {
  config: SchoolConfig
  onBackToConfig: () => void
}

export interface Subject {
  id: string
  name: string
  color: string
  totalHours: number
  remainingHours: number
}

export interface TimeSlot {
  id: string
  day: string
  startTime: string
  endTime: string
  subject?: Subject
  subtitle?: string
  duration: number
}

export function TimetableScreen({ config, onBackToConfig }: TimetableScreenProps) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])

  useEffect(() => {
    // Initialize subjects based on cycle
    const subjectsData =
      config.cycle === "cycle2"
        ? [
            { id: "francais", name: "Français", color: "#ef4444", totalHours: 9 * 60 + 10 }, // 9h10
            { id: "maths", name: "Mathématiques", color: "#3b82f6", totalHours: 4 * 60 + 35 }, // 4h35
            { id: "langues", name: "Langues vivantes", color: "#10b981", totalHours: 1 * 60 + 20 }, // 1h20
            { id: "eps", name: "EPS", color: "#f59e0b", totalHours: 2 * 60 + 45 }, // 2h45
            { id: "arts", name: "Enseignements artistiques", color: "#8b5cf6", totalHours: 1 * 60 + 50 }, // 1h50
            { id: "monde", name: "Questionner le monde + EMC", color: "#06b6d4", totalHours: 2 * 60 + 20 }, // 2h20
          ]
        : [
            { id: "francais", name: "Français", color: "#ef4444", totalHours: 7 * 60 + 20 }, // 7h20
            { id: "maths", name: "Mathématiques", color: "#3b82f6", totalHours: 4 * 60 + 35 }, // 4h35
            { id: "langues", name: "Langues vivantes", color: "#10b981", totalHours: 1 * 60 + 20 }, // 1h20
            { id: "eps", name: "EPS", color: "#f59e0b", totalHours: 2 * 60 + 45 }, // 2h45
            { id: "sciences", name: "Sciences et technologie", color: "#84cc16", totalHours: 1 * 60 + 50 }, // 1h50
            { id: "arts", name: "Enseignements artistiques", color: "#8b5cf6", totalHours: 1 * 60 + 50 }, // 1h50
            { id: "histoire", name: "Histoire-géographie + EMC", color: "#06b6d4", totalHours: 2 * 60 + 20 }, // 2h20
          ]

    setSubjects(subjectsData.map((s) => ({ ...s, remainingHours: s.totalHours })))

    // Generate time slots
    generateTimeSlots()
  }, [config])

  const generateTimeSlots = () => {
    const slots: TimeSlot[] = []
    let slotId = 0

    config.schoolDays.forEach((day) => {
      const dayName = getDayName(day)
      let currentTime = parseTime(config.schoolHours.start)
      const endTime = parseTime(config.schoolHours.end)
      const morningBreakStart = parseTime(config.breaks.morning.start)
      const morningBreakEnd = parseTime(config.breaks.morning.end)
      const afternoonBreakStart = parseTime(config.breaks.afternoon.start)
      const afternoonBreakEnd = parseTime(config.breaks.afternoon.end)
      const lunchStart = parseTime(config.lunchTime.start)
      const lunchEnd = parseTime(config.lunchTime.end)

      while (currentTime < endTime) {
        let slotEnd = currentTime + 60 // Default 1 hour slot

        // Skip breaks and lunch
        if (currentTime === morningBreakStart) {
          currentTime = morningBreakEnd
          continue
        }
        if (currentTime === afternoonBreakStart) {
          currentTime = afternoonBreakEnd
          continue
        }
        if (currentTime === lunchStart) {
          currentTime = lunchEnd
          continue
        }

        // Adjust slot end if it would overlap with a break or lunch
        if (slotEnd > morningBreakStart && currentTime < morningBreakStart) {
          slotEnd = morningBreakStart
        }
        if (slotEnd > afternoonBreakStart && currentTime < afternoonBreakStart) {
          slotEnd = afternoonBreakStart
        }
        if (slotEnd > lunchStart && currentTime < lunchStart) {
          slotEnd = lunchStart
        }
        if (slotEnd > endTime) {
          slotEnd = endTime
        }

        if (slotEnd > currentTime) {
          slots.push({
            id: `slot-${slotId++}`,
            day: dayName,
            startTime: formatTime(currentTime),
            endTime: formatTime(slotEnd),
            duration: slotEnd - currentTime,
          })
        }

        currentTime = slotEnd
      }
    })

    setTimeSlots(slots)
  }

  const parseTime = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(":").map(Number)
    return hours * 60 + minutes
  }

  const formatTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`
  }

  const getDayName = (dayId: string): string => {
    const dayNames: { [key: string]: string } = {
      monday: "Lundi",
      tuesday: "Mardi",
      wednesday: "Mercredi",
      thursday: "Jeudi",
      friday: "Vendredi",
      saturday: "Samedi",
    }
    return dayNames[dayId] || dayId
  }

  const handleAutoFill = () => {
    // Simple auto-fill logic - distribute subjects evenly
    const newTimeSlots = [...timeSlots]
    const availableSubjects = [...subjects]

    newTimeSlots.forEach((slot) => {
      if (!slot.subject && availableSubjects.length > 0) {
        // Find subject with most remaining hours
        const subjectToAssign = availableSubjects.reduce((prev, current) =>
          prev.remainingHours > current.remainingHours ? prev : current,
        )

        if (subjectToAssign.remainingHours >= slot.duration) {
          slot.subject = subjectToAssign
          subjectToAssign.remainingHours -= slot.duration
        }
      }
    })

    setTimeSlots(newTimeSlots)
    setSubjects([...availableSubjects])
  }

  const handleExportPDF = () => {
    generatePDF(config, timeSlots)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={onBackToConfig}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Retour à la configuration
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-primary">Emploi du temps - {config.classLevel}</h1>
              <Badge variant="secondary" className="mt-1">
                {config.cycle === "cycle2" ? "Cycle 2" : "Cycle 3"}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAutoFill} variant="outline">
              <Wand2 className="w-4 h-4 mr-2" />
              Remplir automatiquement
            </Button>
            <Button onClick={handleExportPDF}>
              <Download className="w-4 h-4 mr-2" />
              Exporter PDF
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <SubjectPanel subjects={subjects} onSubjectsChange={setSubjects} />
          </div>
          <div className="lg:col-span-3">
            <TimetableGrid
              config={config}
              timeSlots={timeSlots}
              subjects={subjects}
              onTimeSlotsChange={setTimeSlots}
              onSubjectsChange={setSubjects}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
