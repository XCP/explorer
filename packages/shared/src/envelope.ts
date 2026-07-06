/** The read API's response envelope — every /v2 endpoint wraps its payload in this. */
export interface Envelope<T> {
  result: T;
  result_count?: number;
  /** Present on list endpoints; null/absent when there is no further page. */
  next_offset?: number | null;
}
