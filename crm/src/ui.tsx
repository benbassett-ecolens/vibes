import { createContext, useContext } from 'react'
import type { SheetSyncState } from './useSheetSync'

export interface UIContextValue {
  openDeal: (id: string) => void
  ownerFilter: string
  search: string
  sheet: {
    state: SheetSyncState
    available: boolean
    sync: (by?: 'manual' | 'auto') => Promise<void>
  }
}

export const UIContext = createContext<UIContextValue>({
  openDeal: () => {},
  ownerFilter: '',
  search: '',
  sheet: { state: { kind: 'unavailable' }, available: false, sync: async () => {} },
})

export const useUI = () => useContext(UIContext)
