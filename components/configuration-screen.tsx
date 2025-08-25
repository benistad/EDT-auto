"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import type { ClassLevel, Cycle, SchoolConfig } from "@/app/page"

interface ConfigurationScreenProps {
  onComplete: (config: SchoolConfig) => void
}

const DAYS_OF_WEEK = [
  { id: "monday", label: "Lundi" },
  { id: "tuesday", label: "Mardi" },
  { id: "wednesday", label: "Mercredi" },
  { id: "thursday", label: "Jeudi" },
  { id: "friday", label: "Vendredi" },
  { id: "saturday", label: "Samedi" },
]

export function ConfigurationScreen({ onComplete }: ConfigurationScreenProps) {
  const [classLevel, setClassLevel] = useState<ClassLevel>("CP")
  const [schoolDays, setSchoolDays] = useState<string[]>(["monday", "tuesday", "thursday", "friday"])
  const [schoolStart, setSchoolStart] = useState("08:30")
  const [schoolEnd, setSchoolEnd] = useState("16:30")
  const [morningBreakStart, setMorningBreakStart] = useState("10:15")
  const [morningBreakEnd, setMorningBreakEnd] = useState("10:30")
  const [afternoonBreakStart, setAfternoonBreakStart] = useState("14:45")
  const [afternoonBreakEnd, setAfternoonBreakEnd] = useState("15:00")
  const [lunchStart, setLunchStart] = useState("12:00")
  const [lunchEnd, setLunchEnd] = useState("13:30")

  const getCycle = (level: ClassLevel): Cycle => {
    return ["CP", "CE1", "CE2"].includes(level) ? "cycle2" : "cycle3"
  }

  const handleDayToggle = (dayId: string, checked: boolean) => {
    if (checked) {
      setSchoolDays([...schoolDays, dayId])
    } else {
      setSchoolDays(schoolDays.filter((day) => day !== dayId))
    }
  }

  const handleSubmit = () => {
    const config: SchoolConfig = {
      classLevel,
      cycle: getCycle(classLevel),
      schoolDays,
      schoolHours: {
        start: schoolStart,
        end: schoolEnd,
      },
      breaks: {
        morning: { start: morningBreakStart, end: morningBreakEnd },
        afternoon: { start: afternoonBreakStart, end: afternoonBreakEnd },
      },
      lunchTime: {
        start: lunchStart,
        end: lunchEnd,
      },
    }
    onComplete(config)
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Générateur d'Emploi du Temps</h1>
        <p className="text-muted-foreground">Configuration pour les classes du CP au CM2</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Niveau de classe</CardTitle>
            <CardDescription>Sélectionnez le niveau de votre classe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="class-level">Classe</Label>
                <Select value={classLevel} onValueChange={(value: ClassLevel) => setClassLevel(value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choisir une classe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CP">CP (Cycle 2)</SelectItem>
                    <SelectItem value="CE1">CE1 (Cycle 2)</SelectItem>
                    <SelectItem value="CE2">CE2 (Cycle 2)</SelectItem>
                    <SelectItem value="CM1">CM1 (Cycle 3)</SelectItem>
                    <SelectItem value="CM2">CM2 (Cycle 3)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>Cycle sélectionné :</strong> {getCycle(classLevel) === "cycle2" ? "Cycle 2" : "Cycle 3"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jours d'école</CardTitle>
            <CardDescription>Sélectionnez les jours de classe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {DAYS_OF_WEEK.map((day) => (
                <div key={day.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={day.id}
                    checked={schoolDays.includes(day.id)}
                    onCheckedChange={(checked) => handleDayToggle(day.id, checked as boolean)}
                  />
                  <Label htmlFor={day.id}>{day.label}</Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Horaires d'école</CardTitle>
            <CardDescription>Définissez les heures de début et fin de classe</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label htmlFor="school-start">Début des cours</Label>
                <Input
                  id="school-start"
                  type="time"
                  value={schoolStart}
                  onChange={(e) => setSchoolStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="school-end">Fin des cours</Label>
                <Input id="school-end" type="time" value={schoolEnd} onChange={(e) => setSchoolEnd(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Récréations</CardTitle>
            <CardDescription>Configurez les deux récréations quotidiennes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Récréation du matin</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <Label htmlFor="morning-break-start" className="text-xs">
                      Début
                    </Label>
                    <Input
                      id="morning-break-start"
                      type="time"
                      value={morningBreakStart}
                      onChange={(e) => setMorningBreakStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="morning-break-end" className="text-xs">
                      Fin
                    </Label>
                    <Input
                      id="morning-break-end"
                      type="time"
                      value={morningBreakEnd}
                      onChange={(e) => setMorningBreakEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium">Récréation de l'après-midi</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <Label htmlFor="afternoon-break-start" className="text-xs">
                      Début
                    </Label>
                    <Input
                      id="afternoon-break-start"
                      type="time"
                      value={afternoonBreakStart}
                      onChange={(e) => setAfternoonBreakStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="afternoon-break-end" className="text-xs">
                      {" "}
                      Fin
                    </Label>
                    <Input
                      id="afternoon-break-end"
                      type="time"
                      value={afternoonBreakEnd}
                      onChange={(e) => setAfternoonBreakEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Horaires de cantine</CardTitle>
            <CardDescription>Définissez la pause déjeuner</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <Label htmlFor="lunch-start">Début du déjeuner</Label>
                <Input
                  id="lunch-start"
                  type="time"
                  value={lunchStart}
                  onChange={(e) => setLunchStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lunch-end">Fin du déjeuner</Label>
                <Input id="lunch-end" type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 text-center">
        <Button onClick={handleSubmit} size="lg" className="px-8" disabled={schoolDays.length === 0}>
          Créer l'emploi du temps
        </Button>
      </div>
    </div>
  )
}
