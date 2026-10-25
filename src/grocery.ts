import { loadGroceries, save, type GroceryItem } from './storage'

export interface GroceryProvider {
  list(): Promise<GroceryItem[]>
  save(items: GroceryItem[]): Promise<boolean>
}

export class LocalGroceryProvider implements GroceryProvider {
  async list(): Promise<GroceryItem[]> {
    return loadGroceries()
  }

  async save(items: GroceryItem[]): Promise<boolean> {
    return save('groceries', { items })
  }
}

// A future server-backed adapter can implement this contract after Keep supports safe checklist updates.
export class GoogleKeepGroceryProvider implements GroceryProvider {
  async list(): Promise<GroceryItem[]> {
    throw new Error('Google Keep grocery sync is not available.')
  }

  async save(): Promise<boolean> {
    throw new Error('Google Keep grocery sync is not available.')
  }
}
