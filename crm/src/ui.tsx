import { createContext, useContext } from 'react'

export interface UIContextValue {
  openDeal: (id: string) => void
  ownerFilter: string
  search: string
}

export const UIContext = createContext<UIContextValue>({
  openDeal: () => {},
  ownerFilter: '',
  search: '',
})

export const useUI = () => useContext(UIContext)
