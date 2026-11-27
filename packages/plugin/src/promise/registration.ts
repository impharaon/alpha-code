/** The Effect invocation owns cancellation; callback completion does not end plugin lifetime. */
export type InvocationContext = { readonly signal: AbortSignal }

export interface Registration {
  readonly dispose: () => Promise<void>
}

export interface ModelHookOptions {
  /** Limits the hook to one provider. Unscoped hooks apply to every provider. */
  readonly providerID?: string
}

export type Hooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name], context: InvocationContext) => Promise<void> | void,
) => Promise<Registration>

export type ModelHooks<Spec> = <Name extends keyof Spec>(
  name: Name,
  callback: (input: Spec[Name], context: InvocationContext) => Promise<void> | void,
  options?: Spec[Name] extends { readonly model: unknown } ? ModelHookOptions : never,
) => Promise<Registration>

export type Transform<Input> = (callback: (input: Input) => void) => Promise<Registration>
