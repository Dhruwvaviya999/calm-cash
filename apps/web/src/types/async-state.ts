/** State of an asynchronous operation; components must narrow on `status` before reading data. */
export type AsyncState<TData> =
  { status: 'loading' } | { status: 'success'; data: TData } | { status: 'error'; error: unknown };
