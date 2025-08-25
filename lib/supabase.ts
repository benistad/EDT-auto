import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types pour les sauvegardes d'emplois du temps
export interface TimetableSave {
  id?: string
  name: string
  class_name: string
  days_config: any
  blocks: any[]
  subjects: any[]
  created_at?: string
  updated_at?: string
}

// Fonctions pour gérer les sauvegardes
export async function saveTimetable(save: Omit<TimetableSave, 'id' | 'created_at' | 'updated_at'>) {
  const { data, error } = await supabase
    .from('timetable_saves')
    .insert([save])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function loadTimetables() {
  const { data, error } = await supabase
    .from('timetable_saves')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function deleteTimetable(id: string) {
  const { error } = await supabase
    .from('timetable_saves')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function updateTimetable(id: string, updates: Partial<TimetableSave>) {
  const { data, error } = await supabase
    .from('timetable_saves')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
