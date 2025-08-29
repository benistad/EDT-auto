import type { SchoolConfig, TimeSlot } from "@/lib/types"
import { minutesToHM } from "@/lib/utils"

// Convertit un hex (#rrggbb ou #rgb) en rgba avec alpha
function hexToRGBA(hex: string, alpha = 0.15): string {
  try {
    let h = hex.trim()
    if (h.startsWith("#")) h = h.slice(1)
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16)
      const g = parseInt(h[1] + h[1], 16)
      const b = parseInt(h[2] + h[2], 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16)
      const g = parseInt(h.slice(2, 4), 16)
      const b = parseInt(h.slice(4, 6), 16)
      return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
  } catch {}
  // Fallback: bleu clair si non-hex
  return "rgba(56, 189, 248, 0.15)" // sky-400 à ~15%
}

export function generatePDF(config: SchoolConfig, timeSlots: TimeSlot[]) {
  // Create a new window for the PDF content
  const printWindow = window.open("", "_blank")

  if (!printWindow) {
    alert("Veuillez autoriser les pop-ups pour générer le PDF")
    return
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

  

  // Group slots by day
  const days = config.schoolDays.map(getDayName)
  const slotsByDay: { [key: string]: TimeSlot[] } = {}

  days.forEach((day) => {
    slotsByDay[day] = timeSlots.filter((slot) => slot.day === day)
  })

  // Generate HTML content
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Emploi du temps - ${config.classLevel}</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          color: #333;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #374151;
          padding-bottom: 20px;
        }
        .header h1 {
          margin: 0;
          color: #374151;
          font-size: 24px;
        }
        .header p {
          margin: 5px 0;
          color: #6b7280;
        }
        .timetable {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .timetable th {
          background-color: #374151;
          color: white;
          padding: 12px 8px;
          text-align: center;
          font-weight: bold;
        }
        .timetable td {
          border: 1px solid #d1d5db;
          padding: 8px;
          vertical-align: top;
          min-height: 60px;
        }
        .time-slot {
          background-color: #f8fafc;
          padding: 8px;
          margin-bottom: 4px;
          border-radius: 4px;
          border-left: 4px solid #6366f1;
        }
        .time-slot.has-subject {
          /* La couleur réelle est appliquée inline via style="background-color: ..." */
          background-color: #f0f9ff;
        }
        .time-info {
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 4px;
        }
        .subject-name {
          font-weight: bold;
          font-size: 13px;
          margin-bottom: 2px;
        }
        .subject-subtitle {
          font-size: 11px;
          color: #6b7280;
          font-style: italic;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #d1d5db;
          font-size: 12px;
          color: #6b7280;
        }
        @media print {
          body { margin: 0; }
          .header { page-break-after: avoid; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Emploi du temps - ${config.classLevel}</h1>
        <p>${config.cycle === "cycle2" ? "Cycle 2" : "Cycle 3"}</p>
        <p>Horaires: ${config.schoolHours.start} - ${config.schoolHours.end}</p>
      </div>

      <table class="timetable">
        <thead>
          <tr>
            <th style="width: 100px;">Horaires</th>
            ${days.map((day) => `<th>${day}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${generateTableRows(days, slotsByDay, minutesToHM)}
        </tbody>
      </table>

      <div class="footer">
        <p>Généré le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR")}</p>
        <p>Volume horaire hebdomadaire: 22 heures (hors récréations)</p>
      </div>
    </body>
    </html>
  `

  printWindow.document.write(htmlContent)
  printWindow.document.close()

  // Wait for content to load then print
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print()
    }, 500)
  }
}

function generateTableRows(
  days: string[],
  slotsByDay: { [key: string]: TimeSlot[] },
  formatDuration: (minutes: number) => string,
): string {
  // Find all unique time periods
  const allSlots = Object.values(slotsByDay).flat()
  const uniqueTimes = [...new Set(allSlots.map((slot) => `${slot.startTime}-${slot.endTime}`))].sort()

  return uniqueTimes
    .map((timeRange) => {
      const [startTime, endTime] = timeRange.split("-")

      return `
      <tr>
        <td style="background-color: #f8fafc; font-weight: bold; text-align: center;">
          ${startTime}<br>-<br>${endTime}
        </td>
        ${days
          .map((day) => {
            const slot = slotsByDay[day]?.find((s) => s.startTime === startTime && s.endTime === endTime)

            if (!slot) {
              return "<td></td>"
            }

            if (slot.subject) {
              const base = slot.subject.color || "#6366f1"; // indigo-500 fallback
              const bg = hexToRGBA(base, 0.15);
              return `
              <td>
                <div class="time-slot has-subject" style="border-left-color: ${base}; background-color: ${bg};">
                  <div class="time-info">${formatDuration(slot.duration)}</div>
                  <div class="subject-name" style="color: ${base};">
                    ${slot.subject.name}
                  </div>
                  ${slot.subtitle ? `<div class="subject-subtitle">${slot.subtitle}</div>` : ""}
                </div>
              </td>
            `
            } else {
              return `
              <td>
                <div class="time-slot">
                  <div class="time-info">${formatDuration(slot.duration)}</div>
                </div>
              </td>
            `
            }
          })
          .join("")}
      </tr>
    `
    })
    .join("")
}
