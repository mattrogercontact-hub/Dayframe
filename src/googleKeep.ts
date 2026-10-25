export interface KeepStatus { configured: boolean; connected: boolean; selectedNoteName: string | null }
export interface KeepNoteChoice { name: string; title: string; itemCount: number; updated?: string }
export interface KeepItem { id: string; text: string; checked: boolean; level: number }
export interface KeepList { title: string; updated?: string; items: KeepItem[] }

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/calendar/keep${path}`, { cache: 'no-store', ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Google Keep request failed.')
  return data as T
}

export function getKeepStatus() { return api<KeepStatus>('/status') }
export function getKeepNotes() { return api<{ notes: KeepNoteChoice[]; selectedNoteName: string | null }>('/notes') }
export function getKeepList() { return api<{ note: KeepList }>('/items') }
export function selectKeepNote(name: string) {
  return api<{ selectedNoteName: string }>('/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }) })
}
