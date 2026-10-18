/** Keep the current state in one place; input and view only exchange events. */
export function createController({ initialState, transition, render }) {
  let state = initialState;
  let dispatching = false;
  render(state);
  return {
    getState: () => state,
    dispatch(event) {
      if (dispatching) return state;
      dispatching = true;
      try {
        const next = transition(state, event);
        if (next !== state) {
          state = next;
          render(state);
        }
        return state;
      } finally {
        dispatching = false;
      }
    },
  };
}
