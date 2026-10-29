/** Reference data every page needs: pipelines/stages, users, lost reasons. Loaded once, refreshable. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import type { LostReason, Pipeline, Stage, User } from '../shared/types'

interface RefState {
  pipelines: Pipeline[]
  users: User[]
  lostReasons: LostReason[]
  stageById: Map<string, Stage>
  userById: Map<string, User>
  loaded: boolean
  refresh: () => Promise<void>
}

const Ctx = createContext<RefState>({ pipelines: [], users: [], lostReasons: [], stageById: new Map(), userById: new Map(), loaded: false, refresh: async () => {} })
export const useRef_ = () => useContext(Ctx)
export const useRefData = useRef_

export function RefProvider({ children }: { children: ReactNode }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [lostReasons, setLostReasons] = useState<LostReason[]>([])
  const [loaded, setLoaded] = useState(false)
  const refresh = useCallback(async () => {
    const [p, u, l] = await Promise.all([
      api.get<{ items: Pipeline[] }>('/api/pipelines'),
      api.get<{ items: User[] }>('/api/users'),
      api.get<{ items: LostReason[] }>('/api/lost-reasons'),
    ])
    setPipelines(p.items)
    setUsers(u.items)
    setLostReasons(l.items)
    setLoaded(true)
  }, [])
  useEffect(() => void refresh(), [refresh])
  const value = useMemo<RefState>(
    () => ({
      pipelines,
      users,
      lostReasons,
      loaded,
      refresh,
      stageById: new Map(pipelines.flatMap((p) => p.stages).map((s) => [s.id, s])),
      userById: new Map(users.map((u) => [u.id, u])),
    }),
    [pipelines, users, lostReasons, loaded, refresh],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
