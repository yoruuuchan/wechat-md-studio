import type { User } from '@db/schema'

export type SessionPayload = {
  /** Owner id inside the files table. Single-owner deployment, so it is fixed. */
  uid: number
}

/** The one and only account. No sign-up, no user table. */
export const OWNER: User = {
  id: 1,
  unionId: 'owner',
  name: 'Yoru',
  email: null,
  avatar: null,
  role: 'admin',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignInAt: new Date(0),
}
