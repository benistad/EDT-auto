"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import type { Subject } from "@/components/timetable-screen"
import { minutesToHM } from "@/lib/utils"

interface SubjectPanelProps {
  subjects: Subject[]
  onSubjectsChange: (subjects: Subject[]) => void
}

export function SubjectPanel({ subjects }: SubjectPanelProps) {

  const getProgressPercentage = (subject: Subject): number => {
    return ((subject.totalHours - subject.remainingHours) / subject.totalHours) * 100
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Matières</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {subjects.map((subject) => (
          <div
            key={subject.id}
            className="p-3 border rounded-lg cursor-grab active:cursor-grabbing hover:bg-muted/50 transition-colors"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/json", JSON.stringify(subject))
            }}
            style={{ borderColor: subject.color }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-sm">{subject.name}</h3>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: subject.color }} />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Restant: {minutesToHM(subject.remainingHours)}</span>
                <span>Total: {minutesToHM(subject.totalHours)}</span>
              </div>

              <Progress value={getProgressPercentage(subject)} className="h-2" />

              {subject.remainingHours === 0 && (
                <Badge variant="secondary" className="text-xs">
                  Complété
                </Badge>
              )}
            </div>
          </div>
        ))}

        <div className="pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-2">Volume horaire hebdomadaire :</p>
            <p>22 heures (sans récréations)</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
