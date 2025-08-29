import html2canvas from "html2canvas"
import { parse, converter } from "culori"

/**
 * Sanitize unsupported CSS color formats (e.g., oklch) on a cloned subtree.
 * It removes inline oklch() occurrences and applies safe fallbacks when
 * computed styles contain oklch values to avoid rendering issues in html2canvas.
 */
export function sanitizeOklchInClone(root: HTMLElement) {
  try {
    const doc = root.ownerDocument || document
    const view = doc.defaultView || window
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement
      try {
        const toRgb = converter('rgb')
        const setImp = (el: HTMLElement, prop: string, val?: string) => {
          if (val && typeof val === 'string' && val.trim().length) {
            try { el.style.setProperty(prop, val, 'important') } catch {}
          }
        }
        const replaceOklx = (str: string) => {
          // Remplacer d'abord oklch(...), puis oklab(...)
          const repl = (s: string, re: RegExp) =>
            s.replace(re, (m) => {
              try {
                const c = parse(m)
                if (!c) return m
                const rgb = toRgb(c) as any
                if (!rgb || rgb.r == null || rgb.g == null || rgb.b == null) return m
                const r = Math.round(rgb.r * 255)
                const g = Math.round(rgb.g * 255)
                const b = Math.round(rgb.b * 255)
                const a = typeof rgb.alpha === 'number' ? Math.max(0, Math.min(1, rgb.alpha)) : 1
                return `rgba(${r}, ${g}, ${b}, ${a})`
              } catch {
                return m
              }
            })
          let out = repl(str, /oklch\s*\([^)]*\)/gi)
          out = repl(out, /oklab\s*\([^)]*\)/gi)
          return out
        }

        const inline = (el as HTMLElement).getAttribute && (el as HTMLElement).getAttribute("style")
        if (inline && (inline.includes("oklch") || inline.includes("oklab"))) {
          // Convertit oklch() -> rgb() dans les styles inline
          el.setAttribute("style", replaceOklx(inline))
        }

        const cs: CSSStyleDeclaration | null = view.getComputedStyle ? view.getComputedStyle(el) : null
        if (cs) {
          const anyCs = cs as any
          // Always override common color-bearing properties with OKLx (oklch/oklab) → RGBA replacements
          setImp(el, 'color', replaceOklx(cs.color || ''))
          setImp(el, 'background', replaceOklx(cs.background || ''))
          setImp(el, 'background-color', replaceOklx(cs.backgroundColor || ''))
          setImp(el, 'background-image', replaceOklx(cs.backgroundImage || ''))
          setImp(el, 'border', replaceOklx((anyCs.border as string) || ''))
          setImp(el, 'border-color', replaceOklx(cs.borderColor || ''))
          setImp(el, 'border-top', replaceOklx((anyCs.borderTop as string) || ''))
          setImp(el, 'border-right', replaceOklx((anyCs.borderRight as string) || ''))
          setImp(el, 'border-bottom', replaceOklx((anyCs.borderBottom as string) || ''))
          setImp(el, 'border-left', replaceOklx((anyCs.borderLeft as string) || ''))
          setImp(el, 'border-top-color', replaceOklx((anyCs.borderTopColor as string) || ''))
          setImp(el, 'border-right-color', replaceOklx((anyCs.borderRightColor as string) || ''))
          setImp(el, 'border-bottom-color', replaceOklx((anyCs.borderBottomColor as string) || ''))
          setImp(el, 'border-left-color', replaceOklx((anyCs.borderLeftColor as string) || ''))
          setImp(el, 'box-shadow', replaceOklx(cs.boxShadow || ''))
          setImp(el, 'outline', replaceOklx((anyCs.outline as string) || ''))
          setImp(el, 'outline-color', replaceOklx((anyCs.outlineColor as string) || ''))
          setImp(el, 'text-decoration', replaceOklx((anyCs.textDecoration as string) || ''))
          setImp(el, 'text-decoration-color', replaceOklx((anyCs.textDecorationColor as string) || ''))
          setImp(el, 'text-shadow', replaceOklx((anyCs.textShadow as string) || ''))
          // SVG & UI-specific
          setImp(el, 'fill', replaceOklx((anyCs.fill as string) || ''))
          setImp(el, 'stroke', replaceOklx((anyCs.stroke as string) || ''))
          setImp(el, 'stop-color', replaceOklx((anyCs.stopColor as string) || ''))
          setImp(el, 'caret-color', replaceOklx((anyCs.caretColor as string) || ''))
          setImp(el, 'accent-color', replaceOklx((anyCs.accentColor as string) || ''))
          setImp(el, 'column-rule-color', replaceOklx((anyCs.columnRuleColor as string) || ''))
          setImp(el, 'text-emphasis-color', replaceOklx((anyCs.textEmphasisColor as string) || ''))

          // Pseudo-éléments: si ::before/::after contiennent oklch, on les neutralise sélectivement via une classe
          const csBefore = view.getComputedStyle ? view.getComputedStyle(el, '::before') : null
          const csAfter = view.getComputedStyle ? view.getComputedStyle(el, '::after') : null
          const has = (v: string | null | undefined) => typeof v === 'string' && (v.includes('oklch') || v.includes('oklab'))
          const pseudoHasOklch = (pcs: CSSStyleDeclaration | null) =>
            pcs && (has(pcs.color) || has(pcs.background) || has(pcs.backgroundColor) || has(pcs.backgroundImage) || has(pcs.boxShadow))
          if (pseudoHasOklch(csBefore) || pseudoHasOklch(csAfter)) {
            el.classList.add('pdf-disable-pe')
          }

          // Remplacer aussi dans les variables CSS personnalisées (--*) éventuellement utilisées par Tailwind
          try {
            const len = typeof (cs as any).length === 'number' ? (cs as any).length : 0
            for (let i = 0; i < len; i++) {
              const prop = (cs as any).item ? (cs as any).item(i) : null
              if (!prop || typeof prop !== 'string') continue
              if (prop.startsWith('--')) {
                const val = cs.getPropertyValue(prop)
                if (has(val)) {
                  setImp(el, prop, replaceOklx(val))
                }
              }
            }
          } catch {}
        }
      } catch (_) {}
    }
  } catch (_) {}
}

function scanForOklch(root: HTMLElement, label: string) {
  try {
    const doc = root.ownerDocument || document
    const view = doc.defaultView || window
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    let count = 0
    while (walker.nextNode()) {
      const el = walker.currentNode as HTMLElement
      const cs = view.getComputedStyle ? view.getComputedStyle(el) : null
      if (!cs) continue
      const has = (v?: string | null) => typeof v === 'string' && (v.includes('oklch') || v.includes('oklab'))
      if (
        has(cs.color) || has(cs.background) || has(cs.backgroundColor) || has(cs.backgroundImage) ||
        has(cs.borderColor) || has(cs.boxShadow) || has((cs as any).outlineColor) || has((cs as any).textDecorationColor)
      ) {
        count++
        if (count <= 3) {
          console.debug('[pdf-utils] leftover OKLx', { label, tag: el.tagName, class: el.className, id: el.id })
        }
      }
    }
    if (count > 0) console.warn(`[pdf-utils] scan '${label}': ${count} elements still contain oklch/oklab`)
  } catch {}
}

/**
 * Rasterize a DOM node to an offscreen canvas using html2canvas.
 * The node is cloned into a hidden wrapper to avoid layout shifts.
 */
export async function rasterizeNode(
  node: HTMLElement,
  options?: { scale?: number; backgroundColor?: string; useCORS?: boolean }
): Promise<HTMLCanvasElement> {
  const clone = node.cloneNode(true) as HTMLElement
  const wrapper = document.createElement('div')
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-10000px'
  wrapper.style.top = '-10000px'
  wrapper.style.background = '#ffffff'
  wrapper.style.padding = '0'
  wrapper.style.margin = '0'
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)
  // Style temporaire pour neutraliser les pseudo-éléments et certains gradients qui utilisent oklch
  const tempStyle = document.createElement('style')
  tempStyle.textContent = `
    /* Réduire au strict minimum pour éviter d'écraser les couleurs utiles */
    *::before, *::after { box-shadow: none !important; outline: none !important; }
    /* Désactiver uniquement les pseudo-éléments identifiés comme problématiques */
    .pdf-disable-pe::before, .pdf-disable-pe::after {
      content: none !important;
      background: none !important;
      box-shadow: none !important;
      outline: none !important;
    }
  `
  wrapper.appendChild(tempStyle)
  try {
    sanitizeOklchInClone(clone)
    scanForOklch(clone, 'before-html2canvas')
    const canvas = await html2canvas(clone, {
      scale: options?.scale ?? 2,
      backgroundColor: options?.backgroundColor ?? '#ffffff',
      useCORS: options?.useCORS ?? true,
      // foreignObjectRendering may yield blank canvases depending on browser/CSS
      // Disable it to improve reliability for PDF export rendering
      foreignObjectRendering: false,
      onclone: (clonedDoc) => {
        try {
          // Inject the pseudo-element disabling rule into the cloned document
          const s = clonedDoc.createElement('style')
          s.textContent = `
            .pdf-disable-pe::before, .pdf-disable-pe::after {
              content: none !important;
              background: none !important;
              box-shadow: none !important;
              outline: none !important;
            }
          `
          clonedDoc.head.appendChild(s)
        } catch {}
        try {
          // Forcer un fond blanc sur html/body dans le clone
          const htmlEl = clonedDoc.documentElement as HTMLElement
          const bodyEl = clonedDoc.body as HTMLElement
          if (htmlEl?.style?.setProperty) htmlEl.style.setProperty('background-color', '#ffffff', 'important')
          if (bodyEl?.style?.setProperty) bodyEl.style.setProperty('background-color', '#ffffff', 'important')
        } catch {}
        try { sanitizeOklchInClone(clonedDoc.documentElement as HTMLElement) } catch {}
        try { scanForOklch(clonedDoc.documentElement as HTMLElement, 'onclone-after-sanitize') } catch {}
      },
    })
    return canvas
  } finally {
    if (tempStyle && tempStyle.parentNode) tempStyle.parentNode.removeChild(tempStyle)
    if (wrapper && wrapper.parentNode) {
      wrapper.parentNode.removeChild(wrapper)
    }
  }
}

/**
 * Aggressive rasterization used by EDTWizard: temporarily overrides styles in the live document
 * to ensure safe colors and no shadows, then captures with html2canvas. This avoids regressions
 * for components relying on the aggressive approach.
 */
export async function rasterizeNodeAggressive(
  node: HTMLElement,
  options?: { scale?: number }
): Promise<HTMLCanvasElement> {
  // Inject temporary global overrides
  const tempStyle = document.createElement('style')
  tempStyle.textContent = `
    * {
      background-color: #ffffff !important;
      color: #111111 !important;
      border-color: #cccccc !important;
      outline-color: transparent !important;
      text-decoration-color: transparent !important;
      box-shadow: none !important;
    }
    .bg-indigo-100 { background-color: #e0e7ff !important; }
    .bg-rose-100 { background-color: #ffe4e6 !important; }
    .bg-amber-100 { background-color: #fef3c7 !important; }
    .bg-emerald-100 { background-color: #d1fae5 !important; }
    .bg-pink-100 { background-color: #fce7f3 !important; }
    .bg-sky-100 { background-color: #e0f2fe !important; }
    .bg-teal-100 { background-color: #ccfbf1 !important; }
    .bg-cyan-100 { background-color: #cffafe !important; }
    .bg-blue-600 { background-color: #2563eb !important; }
    .bg-rose-500 { background-color: #f43f5e !important; }
    .bg-gray-900 { background-color: #111827 !important; }
    .text-white, .text-primary/foreground, .text-primary-foreground { color: #ffffff !important; }
    .border-indigo-300 { border-color: #a5b4fc !important; }
    .border-rose-300 { border-color: #fda4af !important; }
    .border-amber-300 { border-color: #fcd34d !important; }
    .border-emerald-300 { border-color: #6ee7b7 !important; }
    .border-pink-300 { border-color: #f9a8d4 !important; }
    .border-sky-300 { border-color: #7dd3fc !important; }
    .border-teal-300 { border-color: #5eead4 !important; }
    .border-cyan-300 { border-color: #67e8f9 !important; }
    .bg-primary { background-color: #3b82f6 !important; }
    .border-primary/20 { border-color: rgba(59, 130, 246, 0.2) !important; }
    .bg-gradient-to-r, .from-cyan-100, .to-amber-100, .from-cyan-50, .to-amber-50 { background: #e0f2fe !important; }
  `
  document.head.appendChild(tempStyle)

  try {
    // Small delay to ensure styles apply
    await new Promise((r) => setTimeout(r, 100))
    const canvas = await html2canvas(node, {
      scale: options?.scale ?? 1.5,
      backgroundColor: '#ffffff',
      useCORS: true,
      allowTaint: true,
      logging: false,
      removeContainer: true,
      ignoreElements: (element) => {
        const tagName = element.tagName.toLowerCase()
        return tagName === 'script' || tagName === 'style' || tagName === 'noscript'
      },
      onclone: (clonedDoc) => {
        const all = clonedDoc.querySelectorAll('*')
        all.forEach((el) => {
          const htmlEl = el as HTMLElement
          if (htmlEl.style) {
            htmlEl.style.backgroundColor = htmlEl.style.backgroundColor || '#ffffff'
            htmlEl.style.color = htmlEl.style.color || '#111111'
            htmlEl.style.borderColor = htmlEl.style.borderColor || '#cccccc'
          }
        })
      },
    })
    return canvas
  } finally {
    if (tempStyle.parentNode) tempStyle.parentNode.removeChild(tempStyle)
  }
}

/**
 * Try color-preserving rasterization first, then fall back to aggressive mode on error.
 */
export async function rasterizeWithFallback(
  node: HTMLElement,
  options?: { scale?: number; backgroundColor?: string; useCORS?: boolean }
): Promise<HTMLCanvasElement> {
  try {
    return await rasterizeNode(node, options)
  } catch (err) {
    console.warn('[pdf-utils] Falling back to aggressive rasterization due to error:', err)
    return await rasterizeNodeAggressive(node, { scale: options?.scale ?? 1.5 })
  }
}
