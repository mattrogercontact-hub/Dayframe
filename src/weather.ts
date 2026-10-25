export interface WeatherLocation {
  id: number
  name: string
  region?: string
  country: string
  latitude: number
  longitude: number
}

export interface WeatherReading {
  temperature: number
  code: number
  isDay: boolean
  observedAt: string
  fetchedAt: string
}

export interface SavedWeather {
  location: WeatherLocation | null
  reading: WeatherReading | null
}

const storageKey = 'dayframe.weather.v1'

function validLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== 'object') return false
  const location = value as Record<string, unknown>
  return typeof location.id === 'number' && Number.isFinite(location.id) &&
    typeof location.name === 'string' && location.name.length > 0 &&
    typeof location.country === 'string' &&
    typeof location.latitude === 'number' && Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === 'number' && Math.abs(location.longitude) <= 180
}

function validReading(value: unknown): value is WeatherReading {
  if (!value || typeof value !== 'object') return false
  const reading = value as Record<string, unknown>
  return typeof reading.temperature === 'number' && Number.isFinite(reading.temperature) &&
    typeof reading.code === 'number' && Number.isFinite(reading.code) &&
    typeof reading.isDay === 'boolean' && typeof reading.observedAt === 'string' &&
    typeof reading.fetchedAt === 'string' && !Number.isNaN(Date.parse(reading.fetchedAt))
}

export function loadWeather(): SavedWeather {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null')
    if (raw?.version === 1 && validLocation(raw.location)) {
      return { location: raw.location, reading: validReading(raw.reading) ? raw.reading : null }
    }
  } catch { /* Missing or blocked storage leaves weather unconfigured. */ }
  return { location: null, reading: null }
}

export function saveWeather(weather: SavedWeather): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...weather }))
    return true
  } catch { return false }
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.searchParams.set('name', query.trim())
  url.searchParams.set('count', '6')
  url.searchParams.set('language', 'en')
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('Location search is unavailable. Try again shortly.')
  const data = await response.json()
  return (Array.isArray(data.results) ? data.results : []).map((entry: Record<string, unknown>) => ({
    id: entry.id, name: entry.name, region: entry.admin1, country: entry.country,
    latitude: entry.latitude, longitude: entry.longitude,
  })).filter(validLocation)
}

export async function fetchWeather(location: WeatherLocation): Promise<WeatherReading> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(location.latitude))
  url.searchParams.set('longitude', String(location.longitude))
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('timezone', 'auto')
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('Weather is unavailable right now.')
  const data = await response.json()
  const current = data.current
  const reading = {
    temperature: current?.temperature_2m,
    code: current?.weather_code,
    isDay: current?.is_day === 1,
    observedAt: current?.time,
    fetchedAt: new Date().toISOString(),
  }
  if (!validReading(reading)) throw new Error('Weather data was incomplete. Try again shortly.')
  return reading
}

export function weatherDescription(code: number): string {
  if (code === 0) return 'Clear'
  if (code === 1) return 'Mostly clear'
  if (code === 2) return 'Partly cloudy'
  if (code === 3) return 'Cloudy'
  if (code === 45 || code === 48) return 'Foggy'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code >= 85 && code <= 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorms'
  return 'Conditions unavailable'
}

export function weatherSymbol(code: number, isDay: boolean): string {
  if (code <= 1) return isDay ? '☀️' : '🌙'
  if (code === 2) return '⛅'
  if (code === 3 || code === 45 || code === 48) return '☁️'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '❄️'
  if (code >= 95) return '⛈️'
  return '🌧️'
}
