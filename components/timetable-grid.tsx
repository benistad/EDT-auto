"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Edit2, Trash2, Clock } from "lucide-react"
import type { SchoolConfig } from "@/app/page"
import type { Subject, TimeSlot } from "@/components/timetable-screen"
import { minutesToHM } from "@/lib/utils"

interface TimetableGridProps {
  config: SchoolConfig
  timeSlots: TimeSlot[]
  subjects: Subject[]
  onTimeSlotsChange: (slots: TimeSlot[]) => void
  onSubjectsChange: (subjects: Subject[]) => void
}

export function TimetableGrid({
  config,
  timeSlots,
  subjects,
  onTimeSlotsChange,
  onSubjectsChange,
}: TimetableGridProps) {
  const [editingSlot, setEditingSlot] = useState<TimeSlot | null>(null)
  const [subtitle, setSubtitle] = useState("")
  const [selectedDuration, setSelectedDuration] = useState<number>(60)

  const durationOptions = [
    { value: 30, label: "30 min" },
    { value: 45, label: "45 min" },
    { value: 60, label: "1h" },
    { value: 90, label: "1h30" },
    { value: 120, label: "2h" },
  ]

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

  const getTimeSlots = () => {
    const days = config.schoolDays.map(getDayName)
    const slotsByDay: { [key: string]: TimeSlot[] } = {}

    days.forEach((day) => {
      slotsByDay[day] = timeSlots.filter((slot) => slot.day === day)
    })

    return { days, slotsByDay }
  }

  const handleDrop = (e: React.DragEvent, targetSlot: TimeSlot) => {
    e.preventDefault()

    try {
      const subjectData = JSON.parse(e.dataTransfer.getData("application/json"))
      const subject = subjects.find((s) => s.id === subjectData.id)

      if (!subject || subject.remainingHours < targetSlot.duration) {
        return
      }

      const updatedSlots = timeSlots.map((slot) =>
        slot.id === targetSlot.id ? { ...slot, subject, subtitle: "" } : slot,
      )

      const updatedSubjects = subjects.map((s) =>
        s.id === subject.id ? { ...s, remainingHours: s.remainingHours - targetSlot.duration } : s,
      )

      onTimeSlotsChange(updatedSlots)
      onSubjectsChange(updatedSubjects)
    } catch (error) {
      console.error("Error handling drop:", error)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleRemoveSubject = (slot: TimeSlot) => {
    if (!slot.subject) return

    const updatedSubjects = subjects.map((s) =>
      s.id === slot.subject!.id ? { ...s, remainingHours: s.remainingHours + slot.duration } : s,
    )

    const updatedSlots = timeSlots.map((s) =>
      s.id === slot.id ? { ...s, subject: undefined, subtitle: undefined } : s,
    )

    onSubjectsChange(updatedSubjects)
    onTimeSlotsChange(updatedSlots)
  }

  const handleEditSlot = (slot: TimeSlot) => {
    setEditingSlot(slot)
    setSubtitle(slot.subtitle || "")
    setSelectedDuration(slot.duration)
  }

  const handleSaveEdit = () => {
    if (!editingSlot) return

    const durationDiff = selectedDuration - editingSlot.duration
    const subject = editingSlot.subject

    // Check if subject has enough remaining hours for duration increase
    if (subject && durationDiff > 0) {
      const subjectData = subjects.find((s) => s.id === subject.id)
      if (!subjectData || subjectData.remainingHours < durationDiff) {
        alert("Pas assez d'heures restantes pour cette matière")
        return
      }
    }

    // Calculate new end time
    const newEndTime = calculateEndTime(editingSlot.startTime, selectedDuration)

    const updatedSlots = timeSlots.map((slot) =>
      slot.id === editingSlot.id ? { ...slot, subtitle, duration: selectedDuration, endTime: newEndTime } : slot,
    )

    // Update subject hours if there's a subject assigned
    let updatedSubjects = subjects
    if (subject) {
      updatedSubjects = subjects.map((s) =>
        s.id === subject.id ? { ...s, remainingHours: s.remainingHours - durationDiff } : s,
      )
    }

    onTimeSlotsChange(updatedSlots)
    onSubjectsChange(updatedSubjects)
    setEditingSlot(null)
    setSubtitle("")
  }

  const calculateEndTime = (startTime: string, durationMinutes: number): string => {
    const [hours, minutes] = startTime.split(":").map(Number)
    const startDate = new Date()
    startDate.setHours(hours, minutes, 0, 0)

    const endDate = new Date(startDate.getTime() + durationMinutes * 60000)
    return `${endDate.getHours().toString().padStart(2, "0")}:${endDate.getMinutes().toString().padStart(2, "0")}`
  }

  

  const { days, slotsByDay } = getTimeSlots()

  return (
    <Card>
      <CardContent className="p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}>
          {days.map((day) => (
            <div key={day} className="space-y-2">
              <h3 className="font-semibold text-center p-2 bg-primary text-primary-foreground rounded">{day}</h3>

              <div className="space-y-2">
                {slotsByDay[day]?.map((slot) => (
                  <div
                    key={slot.id}
                    className={`
                      relative p-3 border-2 border-dashed rounded-lg transition-all
                      ${
                        slot.subject
                          ? "border-solid bg-card"
                          : "border-muted-foreground/30 hover:border-accent hover:bg-accent/5"
                      }
                    `}
                    onDrop={(e) => handleDrop(e, slot)}
                    onDragOver={handleDragOver}
                    style={{
                      borderColor: slot.subject?.color,
                      backgroundColor: slot.subject ? `${slot.subject.color}10` : undefined,
                      height: `${Math.max(80, (slot.duration / 30) * 40)}px`,
                    }}
                  >
                    <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {slot.startTime} - {slot.endTime} ({minutesToHM(slot.duration)})
                    </div>

                    {slot.subject ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-sm" style={{ color: slot.subject.color }}>
                              {slot.subject.name}
                            </div>
                            {slot.subtitle && (
                              <div className="text-xs text-muted-foreground italic">{slot.subtitle}</div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={() => handleEditSlot(slot)}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Éditer le créneau</DialogTitle>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div>
                                    <Label>Matière</Label>
                                    <div className="p-2 bg-muted rounded text-sm">{editingSlot?.subject?.name}</div>
                                  </div>
                                  <div>
                                    <Label>Durée</Label>
                                    <Select
                                      value={selectedDuration.toString()}
                                      onValueChange={(value) => setSelectedDuration(Number(value))}
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {durationOptions.map((option) => (
                                          <SelectItem key={option.value} value={option.value.toString()}>
                                            {option.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label htmlFor="subtitle">Sous-titre (optionnel)</Label>
                                    <Input
                                      id="subtitle"
                                      value={subtitle}
                                      onChange={(e) => setSubtitle(e.target.value)}
                                      placeholder="ex: Grammaire, Calcul mental..."
                                    />
                                  </div>
                                  <Button onClick={handleSaveEdit} className="w-full">
                                    Enregistrer
                                  </Button>
                                </div>
                              </DialogContent>
                            </Dialog>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveSubject(slot)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground text-sm">Glissez une matière ici</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
