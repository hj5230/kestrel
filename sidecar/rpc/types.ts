// The shape every RPC handler has, and who is calling it.
export interface Caller {
  /** True for requests arriving over the LAN listener from a paired device. */
  remote: boolean;
  deviceId?: string;
}

export type Handler = (params: any, caller: Caller) => any;
