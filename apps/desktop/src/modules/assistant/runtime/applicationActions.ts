/** Narrow application commands. No arbitrary settings, filesystem or credentials access. */
export type Appearance = 'standard' | 'atelier' | 'liquid-glass';
export type ApplicationActions = {
  setAppearance: (appearance: Appearance) => { previous: Appearance; current: Appearance; persisted: boolean };
};
export function createApplicationActions(initial: Appearance, set: (value: Appearance) => boolean): ApplicationActions {
  let current = initial;
  return { setAppearance(next) {
    const previous = current;
    const persisted = set(next);
    current = next;
    return { previous, current, persisted };
  } };
}
