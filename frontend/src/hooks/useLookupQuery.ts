import { useCallback, useState } from 'react';
import { useDebounce } from './useDebounce';

/**
 * Search state for a typeahead lookup.
 * `active` turns true on the first search, so lookups fetch only once the list is opened.
 */
export function useLookupQuery(delay = 250) {
  const [query, setQueryState] = useState('');
  const [active, setActive] = useState(false);
  const debounced = useDebounce(query, delay);
  const setQuery = useCallback((q: string) => {
    setActive(true);
    setQueryState(q);
  }, []);
  return { query: debounced, setQuery, active };
}
